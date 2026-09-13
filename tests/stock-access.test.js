import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyStockAccess } from '../src/services/stockAccess.js'

test('正确凭据通过 PBKDF2 验证，错误凭据被拒绝', async () => {
  const valid = String.fromCharCode(49, 49, 49, 52, 53, 55)
  assert.equal(await verifyStockAccess(valid), true)
  assert.equal(await verifyStockAccess(`${valid}0`), false)
  assert.equal(await verifyStockAccess(''), false)
})
