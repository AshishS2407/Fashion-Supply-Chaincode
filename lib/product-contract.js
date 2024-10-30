'use strict';

const { Contract } = require('fabric-contract-api');
const OrderContract = require('./order-contract'); // Link to OrderContract for order management

class ProductContract extends Contract {

    // Check if a product exists
    async productExists(ctx, productId) {
        const buffer = await ctx.stub.getState(productId);
        return (!!buffer && buffer.length > 0);
    }

    async dressExists(ctx, dressId) {
        const buffer = await ctx.stub.getState(dressId);
        return (!!buffer && buffer.length > 0);
    }

    // Supplier creates a product (raw material)
    async createProduct(ctx, productId, type, quantity, quality, supplyDate, origin, supplierName) {
        const mspID = ctx.clientIdentity.getMSPID();
        if (mspID === 'supplierMSP') {
            const exists = await this.productExists(ctx, productId);
            if (exists) {
                throw new Error(`The product ${productId} already exists`);
            }
            const product = {
                type,
                quantity,
                quality,
                supplyDate,
                origin,
                status: 'Supplied',
                ownedBy: supplierName,
                assetType: 'rawMaterial'
            };
            const buffer = Buffer.from(JSON.stringify(product));
            await ctx.stub.putState(productId, buffer);

            const productEvent = { Type: 'Supply creation', ProductType: type };
            await ctx.stub.setEvent('addSupplyEvent', Buffer.from(JSON.stringify(productEvent)));
        } else {
            return `User under MSP ${mspID} is not authorized to create a product`;
        }
    }


    async createDress(ctx, dressId, type, rawMaterialIds) {
        const mspID = ctx.clientIdentity.getMSPID();
        if (mspID === 'manufacturerMSP') {
            const exists = await this.dressExists(ctx, dressId);
            if (exists) {
                throw new Error(`The dress piece ${dressId} already exists`);
            }

            const dress = {
                type,
                rawMaterialIds,
                status: 'Created',
                ownedBy: ctx.clientIdentity.getID(), // Manufacturer ID
                assetType: 'dressPiece'
            };

            const buffer = Buffer.from(JSON.stringify(dress));
            await ctx.stub.putState(dressId, buffer);

            const dressEvent = { Type: 'Dress creation', DressId: dressId, RawMaterials: rawMaterialIds };
            await ctx.stub.setEvent('addDressEvent', Buffer.from(JSON.stringify(dressEvent)));
        } else {
            throw new Error(`User under MSP ${mspID} is not authorized to create a dress`);
        }
    }


    async orderDress(ctx, orderId, dressId, quantity) {
        const mspID = ctx.clientIdentity.getMSPID();
        if (mspID === 'retailerMSP') {
            const dressExists = await this.dressExists(ctx, dressId);
            if (!dressExists) {
                throw new Error(`The dress ${dressId} does not exist`);
            }

            const orderContract = new OrderContract();
            const exists = await orderContract.orderExists(ctx, orderId);
            if (exists) {
                throw new Error(`The order ${orderId} already exists`);
            }

            const order = {
                dressId,
                quantity,
                status: 'Ordered',
                retailerName: ctx.clientIdentity.getID(),
                assetType: 'order'
            };

            const buffer = Buffer.from(JSON.stringify(order));
            await ctx.stub.putState(orderId, buffer);

            const orderEvent = { Type: 'Dress Order', OrderId: orderId, DressId: dressId, Quantity: quantity };
            await ctx.stub.setEvent('orderDressEvent', Buffer.from(JSON.stringify(orderEvent)));

            return `Order ${orderId} for dress ${dressId} placed successfully`;
        } else {
            throw new Error(`User under MSP ${mspID} is not authorized to place an order`);
        }
    }



    // Check for matching orders for a given product based on type and quantity
    async checkMatchingOrders(ctx, productId) {
        const exists = await this.productExists(ctx, productId);
        if (!exists) {
            throw new Error(`The product ${productId} does not exist`);
        }

        const productBuffer = await ctx.stub.getState(productId);
        const productDetails = JSON.parse(productBuffer.toString());

        const queryString = {
            selector: {
                assetType: 'order',
                type: productDetails.type,
                quantity: { "$lte": productDetails.quantity }
            },
        };

        const orderContract = new OrderContract();
        const orders = await orderContract.queryAllOrders(ctx);

        return orders;
    }

    // Match an order with a product, transferring ownership and updating status
    async matchOrder(ctx, productId, orderId) {
        const orderContract = new OrderContract();

        const productExists = await this.productExists(ctx, productId);
        if (!productExists) {
            throw new Error(`The product ${productId} does not exist`);
        }

        const orderExists = await orderContract.orderExists(ctx, orderId);
        if (!orderExists) {
            throw new Error(`The order ${orderId} does not exist`);
        }

        const productDetails = JSON.parse((await ctx.stub.getState(productId)).toString());
        const orderDetails = await orderContract.readOrder(ctx, orderId);

        if (orderDetails.type === productDetails.type && orderDetails.quantity <= productDetails.quantity) {
            productDetails.ownedBy = orderDetails.supplierName;
            productDetails.status = 'Assigned to Order';

            const updatedProductBuffer = Buffer.from(JSON.stringify(productDetails));
            await ctx.stub.putState(productId, updatedProductBuffer);

            await orderContract.deleteOrder(ctx, orderId);
            return `Product ${productId} is assigned to order ${orderId}`;
        } else {
            return 'Order does not match product specifications';
        }
    }


    // Query all products based on assetType
    async queryAllProducts(ctx, assetType) {
        const queryString = { selector: { assetType } };
        const resultIterator = await ctx.stub.getQueryResult(JSON.stringify(queryString));
        const results = await this._getAllResults(resultIterator);
        return JSON.stringify(results);
    }

    // Private helper function to retrieve all results
    async _getAllResults(iterator) {
        const allResults = [];
        let res = await iterator.next();
        while (!res.done) {
            if (res.value && res.value.value.toString()) {
                let jsonRes = {};
                jsonRes.Key = res.value.key;
                jsonRes.Record = JSON.parse(res.value.value.toString());
                allResults.push(jsonRes);
            }
            res = await iterator.next();
        }
        await iterator.close();
        return allResults;
    }

    // Get product history by productId
    async getProductHistory(ctx, productId) {
        const resultIterator = await ctx.stub.getHistoryForKey(productId);
        const results = await this._getAllResults(resultIterator);
        return JSON.stringify(results);
    }



}







module.exports = ProductContract;
