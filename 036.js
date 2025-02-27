// Gateway Service - API Gateway and Service Registry
class APIGateway {
  constructor() {
    this.services = new Map();
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(cors());
    this.app.use(this.authenticate);
    this.app.use(this.logRequest);
  }

  setupRoutes() {
    this.app.use('/graphql', this.createGraphQLServer());
    this.app.use('/api', this.routeRequest);
  }

  createGraphQLServer() {
    const schema = buildSchema(`
      type Product {
        id: ID!
        name: String!
        price: Float!
        stock: Int!
        category: Category!
      }

      type Category {
        id: ID!
        name: String!
        products: [Product]!
      }

      type Order {
        id: ID!
        userId: ID!
        products: [OrderItem]!
        total: Float!
        status: String!
      }

      type OrderItem {
        productId: ID!
        quantity: Int!
        price: Float!
      }

      type Query {
        product(id: ID!): Product
        products(category: ID): [Product]!
        order(id: ID!): Order
        userOrders(userId: ID!): [Order]!
      }

      type Mutation {
        createOrder(products: [OrderInput]!): Order!
        updateOrderStatus(orderId: ID!, status: String!): Order!
      }

      input OrderInput {
        productId: ID!
        quantity: Int!
      }
    `);

    return graphqlHTTP({
      schema,
      rootValue: this.resolvers,
      graphiql: true
    });
  }

  async routeRequest(req, res) {
    const service = this.findService(req.path);
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    try {
      const response = await axios({
        method: req.method,
        url: `${service.url}${req.path}`,
        data: req.body,
        headers: req.headers
      });

      res.status(response.status).json(response.data);
    } catch (error) {
      res.status(error.response?.status || 500).json({
        error: error.message
      });
    }
  }
}

// Product Service
class ProductService {
  constructor() {
    this.app = express();
    this.db = mongoose.connection;
    this.setupDatabase();
    this.setupRoutes();
  }

  async setupDatabase() {
    await mongoose.connect(process.env.MONGODB_URI);
    
    this.ProductModel = mongoose.model('Product', {
      name: String,
      price: Number,
      stock: Number,
      category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' }
    });
  }

  setupRoutes() {
    this.app.get('/products', this.getProducts);
    this.app.get('/products/:id', this.getProduct);
    this.app.post('/products', this.createProduct);
    this.app.put('/products/:id', this.updateProduct);
    this.app.delete('/products/:id', this.deleteProduct);
  }

  async getProducts(req, res) {
    const products = await this.ProductModel.find()
      .populate('category');
    res.json(products);
  }

  async updateStock(productId, quantity) {
    return this.ProductModel.findByIdAndUpdate(
      productId,
      { $inc: { stock: -quantity } },
      { new: true }
    );
  }
}

// Order Service
class OrderService {
  constructor() {
    this.app = express();
    this.db = mongoose.connection;
    this.kafka = new Kafka({
      clientId: 'order-service',
      brokers: [process.env.KAFKA_BROKER]
    });
    
    this.setupDatabase();
    this.setupKafka();
    this.setupRoutes();
  }

  async setupDatabase() {
    await mongoose.connect(process.env.MONGODB_URI);
    
    this.OrderModel = mongoose.model('Order', {
      userId: String,
      products: [{
        productId: String,
        quantity: Number,
        price: Number
      }],
      total: Number,
      status: String,
      createdAt: Date
    });
  }

  async setupKafka() {
    this.producer = this.kafka.producer();
    await this.producer.connect();
  }

  setupRoutes() {
    this.app.post('/orders', this.createOrder);
    this.app.get('/orders/:id', this.getOrder);
    this.app.put('/orders/:id/status', this.updateOrderStatus);
  }

  async createOrder(req, res) {
    const session = await this.db.startSession();
    session.startTransaction();

    try {
      const order = new this.OrderModel({
        ...req.body,
        status: 'pending',
        createdAt: new Date()
      });

      await order.save({ session });

      await this.producer.send({
        topic: 'order-created',
        messages: [{ value: JSON.stringify(order) }]
      });

      await session.commitTransaction();
      res.status(201).json(order);
    } catch (error) {
      await session.abortTransaction();
      res.status(500).json({ error: error.message });
    }
  }
}

// Notification Service
class NotificationService {
  constructor() {
    this.kafka = new Kafka({
      clientId: 'notification-service',
      brokers: [process.env.KAFKA_BROKER]
    });
    
    this.io = new Server();
    this.setupKafka();
    this.setupWebSocket();
  }

  async setupKafka() {
    this.consumer = this.kafka.consumer({ groupId: 'notification-group' });
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: 'order-created' });
    
    this.consumer.run({
      eachMessage: async ({ message }) => {
        const order = JSON.parse(message.value.toString());
        this.notifyUser(order.userId, {
          type: 'order-created',
          orderId: order._id
        });
      }
    });
  }

  setupWebSocket() {
    this.io.on('connection', (socket) => {
      socket.on('authenticate', (userId) => {
        socket.join(userId);
      });
    });
  }

  notifyUser(userId, notification) {
    this.io.to(userId).emit('notification', notification);
  }
}

// Payment Service
class PaymentService {
  constructor() {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    this.app = express();
    this.setupRoutes();
  }

  setupRoutes() {
    this.app.post('/payments', this.processPayment);
    this.app.post('/webhook', this.handleWebhook);
  }

  async processPayment(req, res) {
    const { orderId, token } = req.body;

    try {
      const order = await axios.get(`${process.env.ORDER_SERVICE}/orders/${orderId}`);
      
      const charge = await this.stripe.charges.create({
        amount: order.data.total * 100,
        currency: 'usd',
        source: token,
        description: `Order ${orderId}`
      });

      await axios.put(`${process.env.ORDER_SERVICE}/orders/${orderId}/status`, {
        status: 'paid'
      });

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

// Inventory Service
class InventoryService {
  constructor() {
    this.kafka = new Kafka({
      clientId: 'inventory-service',
      brokers: [process.env.KAFKA_BROKER]
    });
    
    this.setupKafka();
  }

  async setupKafka() {
    this.consumer = this.kafka.consumer({ groupId: 'inventory-group' });
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: 'order-created' });
    
    this.consumer.run({
      eachMessage: async ({ message }) => {
        const order = JSON.parse(message.value.toString());
        await this.updateInventory(order);
      }
    });
  }

  async updateInventory(order) {
    for (const item of order.products) {
      await axios.put(
        `${process.env.PRODUCT_SERVICE}/products/${item.productId}/stock`,
        { quantity: item.quantity }
      );
    }
  }
}

// Analytics Service
class AnalyticsService {
  constructor() {
    this.redis = new Redis();
    this.kafka = new Kafka({
      clientId: 'analytics-service',
      brokers: [process.env.KAFKA_BROKER]
    });
    
    this.setupKafka();
  }

  async setupKafka() {
    this.consumer = this.kafka.consumer({ groupId: 'analytics-group' });
    await this.consumer.connect();
    await this.consumer.subscribe({ 
      topics: ['order-created', 'product-viewed'] 
    });
    
    this.consumer.run({
      eachMessage: async ({ topic, message }) => {
        const data = JSON.parse(message.value.toString());
        await this.processEvent(topic, data);
      }
    });
  }

  async processEvent(topic, data) {
    switch (topic) {
      case 'order-created':
        await this.updateOrderMetrics(data);
        break;
      case 'product-viewed':
        await this.updateProductMetrics(data);
        break;
    }
  }

  async updateOrderMetrics(order) {
    const date = new Date().toISOString().split('T')[0];
    await this.redis.hincrby(`metrics:${date}`, 'order_count', 1);
    await this.redis.hincrby(`metrics:${date}`, 'revenue', order.total);
  }
}

// Docker Compose configuration
const dockerCompose = `
version: '3'
services:
  gateway:
    build: ./gateway
    ports:
      - "3000:3000"
    environment:
      - MONGODB_URI=mongodb://mongodb:27017/ecommerce
      - KAFKA_BROKER=kafka:9092

  product-service:
    build: ./product-service
    environment:
      - MONGODB_URI=mongodb://mongodb:27017/ecommerce

  order-service:
    build: ./order-service
    environment:
      - MONGODB_URI=mongodb://mongodb:27017/ecommerce
      - KAFKA_BROKER=kafka:9092

  notification-service:
    build: ./notification-service
    environment:
      - KAFKA_BROKER=kafka:9092

  payment-service:
    build: ./payment-service
    environment:
      - STRIPE_SECRET_KEY=sk_test_...
      - ORDER_SERVICE=http://order-service:3000

  inventory-service:
    build: ./inventory-service
    environment:
      - KAFKA_BROKER=kafka:9092
      - PRODUCT_SERVICE=http://product-service:3000

  analytics-service:
    build: ./analytics-service
    environment:
      - KAFKA_BROKER=kafka:9092
      - REDIS_URL=redis://redis:6379

  mongodb:
    image: mongo:latest
    ports:
      - "27017:27017"

  kafka:
    image: confluentinc/cp-kafka:latest
    ports:
      - "9092:9092"

  redis:
    image: redis:latest
    ports:
      - "6379:6379"
`;

// Initialize services
const gateway = new APIGateway();
const productService = new ProductService();
const orderService = new OrderService();
const notificationService = new NotificationService();
const paymentService = new PaymentService();
const inventoryService = new InventoryService();
const analyticsService = new AnalyticsService();