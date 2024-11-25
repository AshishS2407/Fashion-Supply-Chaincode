'use strict';

const { Contract } = require('fabric-contract-api');

async function getCollectionName(ctx) {
    const collectionName = 'OrderCollection';
    return collectionName;
}

class OrderContract extends Contract {

    // Check if an order exists
    async orderExists(ctx, orderId) {
        const collectionName = await getCollectionName(ctx);
        const data = await ctx.stub.getPrivateDataHash(collectionName, orderId);
        return (!!data && data.length > 0);
    }

    // Manufacturer creates an order to request supplies from a supplier
    async createOrder(ctx, orderId) {
        const mspid = ctx.clientIdentity.getMSPID();
        if (mspid === 'manufacturerMSP') {
            // Check if order already exists
            const exists = await this.orderExists(ctx, orderId);
            if (exists) {
                throw new Error(`The order ${orderId} already exists`);
            }

            const OrderAsset = {};

            // Retrieve transient data
            const transientData = ctx.stub.getTransient();

            // Validate required fields in transient data
            if (
                transientData.size === 0 ||
                !transientData.has('type') ||
                !transientData.has('quantity') ||
                !transientData.has('price') ||
                !transientData.has('supplierName')
            ) {
                throw new Error(
                    "The expected key was not specified in transient data. Please try again."
                );
            }

            // Set the order properties from transient data
            OrderAsset.type = transientData.get('type').toString();
            OrderAsset.quantity = parseInt(transientData.get('quantity').toString());
            OrderAsset.price = parseFloat(transientData.get('price').toString());
            OrderAsset.supplierName = transientData.get('supplierName').toString();
            OrderAsset.status = 'Requested by Manufacturer';
            OrderAsset.assetType = 'order';

            // Store the order in the private data collection
            const collectionName = await getCollectionName(ctx);
            await ctx.stub.putPrivateData(
                collectionName,
                orderId,
                Buffer.from(JSON.stringify(OrderAsset))
            );
        } else {
            return `Organization with MSP ID ${mspid} cannot create an order`;
        }
    }


    // Read order details by orderId
    async readOrder(ctx, orderId) {
        // Check if the order exists
        const exists = await this.orderExists(ctx, orderId);
        if (!exists) {
            throw new Error(`The order ${orderId} does not exist`);
        }

        // Retrieve the private data
        let privateDataString;
        const collectionName = await getCollectionName(ctx);
        const privateData = await ctx.stub.getPrivateData(collectionName, orderId);

        // Parse the private data to JSON format
        privateDataString = JSON.parse(privateData.toString());
        return privateDataString;
    }


    // Query all orders for the assetType "order"
    async queryAllOrders(ctx) {
        const queryString = {
            selector: {
                assetType: "order",
            },
        };
        const collectionName = await getCollectionName(ctx);
        let resultIterator = await ctx.stub.getPrivateDataQueryResult(
            collectionName,
            JSON.stringify(queryString)
        );
        let result = await this._getAllResults(resultIterator.iterator);
        return JSON.stringify(result);
    }


    // Custom query function to fetch orders with specific criteria
    async _queryAllOrdersWithQueryString(ctx, queryString) {
        const collectionName = await getCollectionName(ctx);
        const resultIterator = await ctx.stub.getPrivateDataQueryResult(collectionName, JSON.stringify(queryString));
        const results = await this._getAllResults(resultIterator.iterator);
        return JSON.stringify(results);
    }

    // Helper function to get all results
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

    // Delete order by orderId
    async deleteOrder(ctx, orderId) {
        const mspid = ctx.clientIdentity.getMSPID();
        if (mspid === 'manufacturerMSP') {
            // Check if the order exists
            const exists = await this.orderExists(ctx, orderId);
            if (!exists) {
                throw new Error(`The order ${orderId} does not exist`);
            }

            // Delete the order from private data
            const collectionName = await getCollectionName(ctx);
            await ctx.stub.deletePrivateData(collectionName, orderId);
        } else {
            return `Organization with MSP ID ${mspid} cannot perform this action.`;
        }
    }





}



module.exports = OrderContract;
