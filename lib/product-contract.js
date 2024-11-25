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


    // Supplier reads a product (raw material)
    async readProduct(ctx, productId) {
        // Check if the product exists in the ledger
        const exists = await this.productExists(ctx, productId);
        if (!exists) {
            throw new Error(`The product ${productId} does not exist`);
        }

        // Retrieve the product data from the ledger
        const buffer = await ctx.stub.getState(productId);
        const product = JSON.parse(buffer.toString());

        return product;
    }


    // Manufacturer creates a dress using raw materials
    async createDress(ctx, dressId, type, productId, quality) {
        const mspID = ctx.clientIdentity.getMSPID();
        if (mspID === 'manufacturerMSP') {
            const dressExists = await this.dressExists(ctx, dressId);
            if (dressExists) {
                throw new Error(`The dress piece ${dressId} already exists`);
            }

            // Check if the raw material exists
            const productBuffer = await ctx.stub.getState(productId);
            if (!productBuffer || productBuffer.length === 0) {
                throw new Error(`The raw material product ${productId} does not exist`);
            }

            // Parse the raw material details
            const productDetails = JSON.parse(productBuffer.toString());

            // Create the dress with raw material details included
            const dress = {
                type,
                productId, // Raw material ID
                rawMaterialDetails: {
                    type: productDetails.type,
                    quantity: productDetails.quantity,
                    quality: productDetails.quality,
                    origin: productDetails.origin,
                    supplyDate: productDetails.supplyDate,
                    supplier: productDetails.ownedBy,
                },
                quality,
                status: 'Created', // Initial status before approval
                ownedBy: ctx.clientIdentity.getID(), // Manufacturer ID
                assetType: 'dressPiece'
            };

            const buffer = Buffer.from(JSON.stringify(dress));
            await ctx.stub.putState(dressId, buffer);

            const dressEvent = {
                Type: 'Dress creation',
                DressId: dressId,
                RawMaterials: productId,
                Quality: quality,
                RawMaterialDetails: productDetails
            };
            await ctx.stub.setEvent('addDressEvent', Buffer.from(JSON.stringify(dressEvent)));
        } else {
            throw new Error(`User under MSP ${mspID} is not authorized to create a dress`);
        }
    }

    // Read a created dress by its ID
    async readDress(ctx, dressId) {
        // Check if the dress exists
        const exists = await this.dressExists(ctx, dressId);
        if (!exists) {
            throw new Error(`The dress ${dressId} does not exist`);
        }

        // Retrieve the dress data from the ledger
        const buffer = await ctx.stub.getState(dressId);
        const dress = JSON.parse(buffer.toString());

        // Return the dress details
        return dress;
    }



    // Validator approves or rejects a dress piece based on quality
    async approveDress(ctx, dressId) {
        const mspID = ctx.clientIdentity.getMSPID();
        if (mspID === 'validatorMSP') {
            const exists = await this.dressExists(ctx, dressId);
            if (!exists) {
                throw new Error(`The dress piece ${dressId} does not exist`);
            }

            const dressBuffer = await ctx.stub.getState(dressId);
            const dress = JSON.parse(dressBuffer.toString());

            if (dress.status !== 'Created') {
                throw new Error(`The dress ${dressId} is not in 'Created' status and cannot be approved`);
            }

            // Perform quality check: assume that quality above 80 is considered good
            if (dress.quality < 80) {
                throw new Error(`The dress ${dressId} does not meet the required quality standards`);
            }

            // Update status to 'Approved' if the dress passes the quality check
            dress.status = 'Approved';

            const updatedDressBuffer = Buffer.from(JSON.stringify(dress));
            await ctx.stub.putState(dressId, updatedDressBuffer);

            // Emit an event indicating approval
            const approvalEvent = { Type: 'Dress Approval', DressId: dressId, Status: 'Approved' };
            await ctx.stub.setEvent('dressApprovalEvent', Buffer.from(JSON.stringify(approvalEvent)));

            return `Dress ${dressId} approved successfully`;
        } else {
            throw new Error(`User under MSP ${mspID} is not authorized to approve the dress`);
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

        // Check if the product exists
        const productExists = await this.productExists(ctx, productId);
        if (!productExists) {
            throw new Error(`The product ${productId} does not exist`);
        }

        // Check if the order exists
        const orderExists = await orderContract.orderExists(ctx, orderId);
        if (!orderExists) {
            throw new Error(`The order ${orderId} does not exist`);
        }

        // Retrieve product and order details
        const productDetails = JSON.parse((await ctx.stub.getState(productId)).toString());
        const orderDetails = await orderContract.readOrder(ctx, orderId);

        // Match the product with the order specifications
        if (orderDetails.type === productDetails.type && orderDetails.quantity <= productDetails.quantity) {
            productDetails.ownedBy = orderDetails.supplierName;
            productDetails.status = 'Assigned to Order';

            // Update product state
            const updatedProductBuffer = Buffer.from(JSON.stringify(productDetails));
            await ctx.stub.putState(productId, updatedProductBuffer);

            // Delete the order after matching
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



    async getDressDetails(ctx, dressId) {
        // Verify MSP authorization
        const mspID = ctx.clientIdentity.getMSPID();
        if (mspID !== 'retailerMSP' && mspID !== 'validatorMSP' && mspID !== 'manufacturerMSP') {
            throw new Error(`User under MSP ${mspID} is not authorized to view the details of the dress`);
        }

        // Check if the dress exists
        const dressExists = await this.dressExists(ctx, dressId);
        if (!dressExists) {
            throw new Error(`The dress ${dressId} does not exist`);
        }

        // Fetch dress details
        const dressBuffer = await ctx.stub.getState(dressId);
        const dress = JSON.parse(dressBuffer.toString());

        // Fetch dress creation history
        const dressHistoryIterator = await ctx.stub.getHistoryForKey(dressId);
        const dressHistory = await this._getAllResults(dressHistoryIterator);

        // Collect raw material details and history
        const rawMaterialDetails = [];
        for (const rawMaterialId of dress.productId) {
            const materialExists = await this.productExists(ctx, rawMaterialId);
            if (materialExists) {
                const materialBuffer = await ctx.stub.getState(rawMaterialId);
                const materialDetails = JSON.parse(materialBuffer.toString());

                const materialHistoryIterator = await ctx.stub.getHistoryForKey(rawMaterialId);
                const materialHistory = await this._getAllResults(materialHistoryIterator);

                rawMaterialDetails.push({ materialDetails, materialHistory });
            }
        }

        // Fetch order details related to this dress
        const queryString = {
            selector: {
                assetType: 'order',
                dressId: dressId
            }
        };
        const orderIterator = await ctx.stub.getQueryResult(JSON.stringify(queryString));
        const orderDetails = await this._getAllResults(orderIterator);

        // Consolidate dress details into a single object
        const dressDetails = {
            dress: dress,
            dressHistory: dressHistory,
            rawMaterials: rawMaterialDetails,
            orders: orderDetails
        };

        return JSON.stringify(dressDetails);
    }


}







module.exports = ProductContract;
