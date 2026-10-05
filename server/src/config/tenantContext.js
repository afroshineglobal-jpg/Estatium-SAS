'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const als = new AsyncLocalStorage();
module.exports = {
  run: (ctx, fn) => als.run(ctx, fn),
  get: () => als.getStore(),
  tenantId: () => als.getStore()?.tenantId,
};
