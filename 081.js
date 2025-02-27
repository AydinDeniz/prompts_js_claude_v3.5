class DeepMerger {
    constructor(options = {}) {
        this.options = {
            arrayMergeStrategy: options.arrayMergeStrategy || 'concat', // concat, replace, unique
            handleCircular: options.handleCircular || true,
            preserveNull: options.preserveNull || false,
            maxDepth: options.maxDepth || 100
        };
        this.seen = new WeakMap();
    }

    merge(target, source) {
        return this.mergeObjects(target, source, 0);
    }

    mergeObjects(target, source, depth = 0) {
        if (depth > this.options.maxDepth) {
            throw new Error('Maximum merge depth exceeded');
        }

        // Handle null and undefined
        if (source === null || source === undefined) {
            return this.options.preserveNull ? source : target;
        }

        // Handle circular references
        if (this.options.handleCircular) {
            if (this.seen.has(source)) {
                return this.seen.get(source);
            }
            this.seen.set(source, target);
        }

        // Create new instance if target and source are different types
        if (target?.constructor !== source?.constructor) {
            return this.cloneValue(source);
        }

        // Handle different types
        switch (this.getType(source)) {
            case 'array':
                return this.mergeArrays(target, source, depth);
            case 'object':
                return this.mergeObjectProperties(target, source, depth);
            case 'date':
                return new Date(source);
            case 'regexp':
                return new RegExp(source);
            case 'map':
                return this.mergeMaps(target, source, depth);
            case 'set':
                return this.mergeSets(target, source);
            default:
                return this.cloneValue(source);
        }
    }

    mergeObjectProperties(target = {}, source, depth) {
        const merged = Object.assign({}, target);

        Object.keys(source).forEach(key => {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
                const sourceValue = source[key];
                const targetValue = target[key];

                merged[key] = this.mergeObjects(targetValue, sourceValue, depth + 1);
            }
        });

        return merged;
    }

    mergeArrays(target = [], source, depth) {
        switch (this.options.arrayMergeStrategy) {
            case 'replace':
                return this.cloneArray(source, depth);
            case 'unique':
                return this.mergeArraysUnique(target, source, depth);
            case 'concat':
            default:
                return this.mergeArraysConcat(target, source, depth);
        }
    }

    mergeArraysConcat(target, source, depth) {
        return [
            ...this.cloneArray(target, depth),
            ...this.cloneArray(source, depth)
        ];
    }

    mergeArraysUnique(target, source, depth) {
        const merged = this.cloneArray(target, depth);
        const sourceClone = this.cloneArray(source, depth);

        sourceClone.forEach(item => {
            if (!this.arrayIncludes(merged, item)) {
                merged.push(item);
            }
        });

        return merged;
    }

    mergeMaps(target = new Map(), source, depth) {
        const merged = new Map(target);

        source.forEach((value, key) => {
            const targetValue = merged.get(key);
            merged.set(
                this.cloneValue(key),
                this.mergeObjects(targetValue, value, depth + 1)
            );
        });

        return merged;
    }

    mergeSets(target = new Set(), source) {
        const merged = new Set(target);
        source.forEach(value => merged.add(this.cloneValue(value)));
        return merged;
    }

    cloneArray(arr, depth) {
        return arr.map(item => this.mergeObjects(undefined, item, depth + 1));
    }

    cloneValue(value) {
        const type = this.getType(value);
        switch (type) {
            case 'array':
                return [...value];
            case 'object':
                return {...value};
            case 'date':
                return new Date(value);
            case 'regexp':
                return new RegExp(value);
            case 'map':
                return new Map(value);
            case 'set':
                return new Set(value);
            default:
                return value;
        }
    }

    arrayIncludes(array, item) {
        return array.some(element => this.isEqual(element, item));
    }

    isEqual(a, b) {
        if (a === b) return true;
        if (this.getType(a) !== this.getType(b)) return false;

        switch (this.getType(a)) {
            case 'array':
                return this.isArrayEqual(a, b);
            case 'object':
                return this.isObjectEqual(a, b);
            case 'date':
                return a.getTime() === b.getTime();
            case 'regexp':
                return a.toString() === b.toString();
            case 'map':
                return this.isMapEqual(a, b);
            case 'set':
                return this.isSetEqual(a, b);
            default:
                return a === b;
        }
    }

    isArrayEqual(a, b) {
        if (a.length !== b.length) return false;
        return a.every((item, index) => this.isEqual(item, b[index]));
    }

    isObjectEqual(a, b) {
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);

        if (keysA.length !== keysB.length) return false;

        return keysA.every(key => 
            Object.prototype.hasOwnProperty.call(b, key) &&
            this.isEqual(a[key], b[key])
        );
    }

    isMapEqual(a, b) {
        if (a.size !== b.size) return false;
        for (const [key, value] of a) {
            if (!b.has(key) || !this.isEqual(value, b.get(key))) {
                return false;
            }
        }
        return true;
    }

    isSetEqual(a, b) {
        if (a.size !== b.size) return false;
        for (const value of a) {
            if (!this.arrayIncludes(Array.from(b), value)) {
                return false;
            }
        }
        return true;
    }

    getType(value) {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (Array.isArray(value)) return 'array';
        if (value instanceof Date) return 'date';
        if (value instanceof RegExp) return 'regexp';
        if (value instanceof Map) return 'map';
        if (value instanceof Set) return 'set';
        return typeof value;
    }
}

// Usage example:
const merger = new DeepMerger({
    arrayMergeStrategy: 'unique',
    handleCircular: true,
    preserveNull: false,
    maxDepth: 100
});

// Example usage:
const obj1 = {
    a: [1, 2, 3],
    b: {
        c: 'hello',
        d: new Date(),
        e: new Map([['key', 'value']]),
        f: new Set([1, 2, 3])
    }
};

const obj2 = {
    a: [3, 4, 5],
    b: {
        c: 'world',
        d: new Date(),
        e: new Map([['key2', 'value2']]),
        f: new Set([3, 4, 5])
    }
};

const merged = merger.merge(obj1, obj2);
console.log(merged);