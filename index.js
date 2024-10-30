'use strict';

const ProductContract = require('./lib/product-contract');
const OrderContract = require('./lib/order-contract');


module.exports.ProductContract = ProductContract;
module.exports.OrderContract = OrderContract;  

module.exports.contracts = [ProductContract,OrderContract];