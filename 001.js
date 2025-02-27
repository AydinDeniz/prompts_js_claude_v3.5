function jsonToCSV(jsonData) {
  const flatten = (obj, prefix = '') => {
    return Object.keys(obj).reduce((acc, key) => {
      const pre = prefix.length ? prefix + '.' : '';
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        Object.assign(acc, flatten(obj[key], pre + key));
      } else {
        acc[pre + key] = obj[key];
      }
      return acc;
    }, {});
  };

  const flattenedData = jsonData.map(item => flatten(item));
  const headers = [...new Set(flattenedData.reduce((acc, curr) => {
    return [...acc, ...Object.keys(curr)];
  }, []))];

  const csv = [
    headers.join(','),
    ...flattenedData.map(item => {
      return headers.map(header => {
        const value = item[header] === undefined ? '' : item[header];
        return typeof value === 'string' ? `"${value}"` : value;
      }).join(',');
    })
  ].join('\n');

  return csv;
}

// Example usage:
const data = [
  {
    id: 1,
    name: "John",
    details: {
      age: 30,
      address: {
        city: "New York",
        zip: "10001"
      }
    }
  },
  {
    id: 2,
    name: "Jane",
    details: {
      age: 25,
      address: {
        city: "Los Angeles"
      }
    }
  }
];

console.log(jsonToCSV(data));