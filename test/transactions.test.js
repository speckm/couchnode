'use strict'

const assert = require('chai').assert

const H = require('./harness')

describe('#transactions', function () {
  before(async function () {
    H.skipIfMissingFeature(this, H.Features.Transactions)
  })

  it('should work with a simple transaction', async function () {
    const testDocIns = H.genTestKey()
    const testDocRep = H.genTestKey()
    const testDocRem = H.genTestKey()

    await H.co.insert(testDocRep, { foo: 'bar' })
    await H.co.insert(testDocRem, { foo: 'bar' })

    await H.c.transactions().run(
      async (attempt) => {
        await attempt.insert(H.co, testDocIns, { foo: 'baz' })

        const repDoc = await attempt.get(H.co, testDocRep)
        await attempt.replace(repDoc, { foo: 'baz' })

        const remDoc = await attempt.get(H.co, testDocRem)
        await attempt.remove(remDoc)

        // check ryow
        var insRes = await attempt.get(H.co, testDocIns)
        assert.deepStrictEqual(insRes.content, { foo: 'baz' })

        var repRes = await attempt.get(H.co, testDocRep)
        assert.deepStrictEqual(repRes.content, { foo: 'baz' })

        await H.throwsHelper(async () => {
          await attempt.get(H.co, testDocRem)
        })
      },
      { timeout: 5000 }
    )

    var insRes = await H.co.get(testDocIns)
    assert.deepStrictEqual(insRes.content, { foo: 'baz' })

    var repRes = await H.co.get(testDocRep)
    assert.deepStrictEqual(repRes.content, { foo: 'baz' })

    await H.throwsHelper(async () => {
      await H.co.get(testDocRem)
    })
  }).timeout(15000)

  it('should work with query', async function () {
    const testKey = H.genTestKey()
    const testDoc1 = testKey + '_1'
    const testDoc2 = testKey + '_2'

    await H.co.insert(testDoc1, { foo: 'bar' })

    await H.c.transactions().run(async (attempt) => {
      const insDoc = await attempt.insert(H.co, testDoc2, { foo: 'baz' })

      const collQualifer = `${H.b.name}.${H.s.name}.${H.co.name}`
      const queryRes = await attempt.query(
        `SELECT foo FROM ${collQualifer} WHERE META().id IN $1 ORDER BY META().id ASC`,
        {
          parameters: [[testDoc1, testDoc2]],
        }
      )
      assert.lengthOf(queryRes.rows, 2)
      assert.deepStrictEqual(queryRes.rows[0], { foo: 'bar' })
      assert.deepStrictEqual(queryRes.rows[1], { foo: 'baz' })

      const getDoc = await attempt.get(H.co, testDoc1)
      await attempt.replace(getDoc, { foo: 'bad' })

      await attempt.replace(insDoc, { foo: 'bag' })
    })

    var gres1 = await H.co.get(testDoc1)
    assert.deepStrictEqual(gres1.content, { foo: 'bad' })

    var gres2 = await H.co.get(testDoc2)
    assert.deepStrictEqual(gres2.content, { foo: 'bag' })
  })

  it('should fail with application errors', async function () {
    const testDocIns = H.genTestKey()
    const testDocRep = H.genTestKey()
    const testDocRem = H.genTestKey()

    await H.co.insert(testDocRep, { foo: 'bar' })
    await H.co.insert(testDocRem, { foo: 'bar' })

    let numAttempts = 0
    try {
      await H.c.transactions().run(async (attempt) => {
        numAttempts++

        await attempt.insert(H.co, testDocIns, { foo: 'baz' })

        const repDoc = await attempt.get(H.co, testDocRep)
        await attempt.replace(repDoc, { foo: 'baz' })

        const remDoc = await attempt.get(H.co, testDocRem)
        await attempt.remove(remDoc)

        throw new Error('application failure')
      })
    } catch (err) {
      assert.instanceOf(err, H.lib.TransactionFailedError)
      assert.equal(err.cause.message, 'application failure')
    }

    assert.equal(numAttempts, 1)

    await H.throwsHelper(async () => {
      await H.co.get(testDocIns)
    })

    var repRes = await H.co.get(testDocRep)
    assert.deepStrictEqual(repRes.content, { foo: 'bar' })

    var remRes = await H.co.get(testDocRep)
    assert.deepStrictEqual(remRes.content, { foo: 'bar' })
  })

  it('should commit with query', async function () {
    const testDocIns = H.genTestKey()
    const testDocRep = H.genTestKey()
    const testDocRem = H.genTestKey()

    await H.co.insert(testDocRep, { foo: 'bar' })
    await H.co.insert(testDocRem, { foo: 'bar' })

    await H.c.transactions().run(async (attempt) => {
      const coPath = `${H.b.name}.${H.s.name}.${H.co.name}`

      await attempt.query(`INSERT INTO ${coPath} VALUES ($1, $2)`, {
        parameters: [testDocIns, { foo: 'baz' }],
      })

      await attempt.query(
        `UPDATE ${coPath} SET foo="baz" WHERE META().id = $1`,
        {
          parameters: [testDocRep],
        }
      )

      await attempt.query(`DELETE FROM ${coPath} WHERE META().id = $1`, {
        parameters: [testDocRem],
      })
    })

    let insRes = await H.co.get(testDocIns)
    assert.deepStrictEqual(insRes.content, { foo: 'baz' })

    let repRes = await H.co.get(testDocRep)
    assert.deepStrictEqual(repRes.content, { foo: 'baz' })

    await H.throwsHelper(async () => {
      await H.co.get(testDocRem)
    })
  })

  it('should rollback after query', async function () {
    const testDocIns = H.genTestKey()
    const testDocRep = H.genTestKey()
    const testDocRem = H.genTestKey()

    await H.co.insert(testDocRep, { foo: 'bar' })
    await H.co.insert(testDocRem, { foo: 'bar' })

    let numAttempts = 0
    try {
      await H.c.transactions().run(async (attempt) => {
        numAttempts++

        const coPath = `${H.b.name}.${H.s.name}.${H.co.name}`

        await attempt.query(`INSERT INTO ${coPath} VALUES ($1, $2)`, {
          parameters: [testDocIns, { foo: 'baz' }],
        })

        await attempt.query(
          `UPDATE ${coPath} SET foo="baz" WHERE META().id = $1`,
          {
            parameters: [testDocRep],
          }
        )

        await attempt.query(`DELETE FROM ${coPath} WHERE META().id = $1`, {
          parameters: [testDocRem],
        })

        throw new Error('application failure')
      })
    } catch (err) {
      assert.instanceOf(err, H.lib.TransactionFailedError)
      assert.equal(err.cause.message, 'application failure')
    }

    assert.equal(numAttempts, 1)

    await H.throwsHelper(async () => {
      await H.co.get(testDocIns)
    })

    var repRes = await H.co.get(testDocRep)
    assert.deepStrictEqual(repRes.content, { foo: 'bar' })

    var remRes = await H.co.get(testDocRep)
    assert.deepStrictEqual(remRes.content, { foo: 'bar' })
  })

  it('should fail to replace with bad CAS', async function () {
    const testDocId = H.genTestKey()

    await H.co.upsert(testDocId, { foo: 'bar' })

    // txn will retry until timeout
    let numAttempts = 0
    try {
      await H.c.transactions().run(
        async (attempt) => {
          numAttempts++
          const remDoc = await attempt.get(H.co, testDocId)
          await attempt.replace(remDoc, { foo: 'baz' })
          // This should fail due to CAS Mismatch
          // Note that atm the cause is set as unknown in the txn lib
          try {
            await attempt.replace(remDoc, { foo: 'qux' })
          } catch (err) {
            assert.instanceOf(err, H.lib.TransactionOperationFailedError)
            assert.equal(err.cause.message, 'unknown')
          }
        },
        { timeout: 2000 }
      )
    } catch (err) {
      assert.instanceOf(err, H.lib.TransactionFailedError)
      assert.equal(err.cause.message, 'unknown')
    }
    assert.isTrue(numAttempts > 1)

    // the txn should fail
    var repRes = await H.co.get(testDocId)
    assert.deepStrictEqual(repRes.content, { foo: 'bar' })
  }).timeout(5000)

  it('should fail to remove with bad CAS', async function () {
    const testDocId = H.genTestKey()

    await H.co.upsert(testDocId, { foo: 'bar' })

    // txn will retry until timeout
    let numAttempts = 0
    try {
      await H.c.transactions().run(
        async (attempt) => {
          numAttempts++
          const remDoc = await attempt.get(H.co, testDocId)
          await attempt.replace(remDoc, { foo: 'baz' })
          // This should fail due to CAS Mismatch
          // Note that atm the cause is set as unknown in the txn lib
          try {
            await attempt.remove(remDoc)
          } catch (err) {
            assert.instanceOf(err, H.lib.TransactionOperationFailedError)
            assert.equal(err.cause.message, 'unknown')
          }
        },
        { timeout: 2000 }
      )
    } catch (err) {
      assert.instanceOf(err, H.lib.TransactionFailedError)
      assert.equal(err.cause.message, 'unknown')
    }
    assert.isTrue(numAttempts > 1)

    // the txn should fail, so doc should exist
    var remRes = await H.co.get(testDocId)
    assert.deepStrictEqual(remRes.content, { foo: 'bar' })
  }).timeout(5000)

  it('should raise DocumentNotFoundError only in lambda', async function () {
    let numAttempts = 0
    await H.throwsHelper(async () => {
      await H.c.transactions().run(
        async (attempt) => {
          numAttempts++
          try {
            await attempt.get(H.co, 'not-a-key')
          } catch (err) {
            assert.instanceOf(err, H.lib.DocumentNotFoundError)
            assert.equal(err.cause, 'document_not_found_exception')
          }

          throw new Error('success')
        },
        {
          timeout: 100,
        }
      )
    }, H.lib.TransactionFailedError)
    assert.equal(numAttempts, 1)

    numAttempts = 0
    try {
      await H.c.transactions().run(
        async (attempt) => {
          numAttempts++
          await attempt.get(H.co, 'not-a-key')
        },
        {
          timeout: 100,
        }
      )
    } catch (err) {
      assert.instanceOf(err, H.lib.TransactionFailedError)
      assert.instanceOf(err.cause, H.lib.DocumentNotFoundError)
      assert.isTrue(err.cause.message.includes('document not found'))
      assert(
        err.context instanceof H.lib.KeyValueErrorContext ||
          typeof err.context === 'undefined'
      )
    }
    assert.equal(numAttempts, 1)
  })

  it('should raise DocumentExistsError only in lambda', async function () {
    const testDocIns = H.genTestKey()

    await H.co.insert(testDocIns, { foo: 'bar' })

    let numAttempts = 0
    await H.throwsHelper(async () => {
      await H.c.transactions().run(
        async (attempt) => {
          numAttempts++

          await H.throwsHelper(async () => {
            await attempt.insert(H.co, testDocIns, { foo: 'baz' })
          }, H.lib.DocumentExistsError)

          throw new Error('success')
        },
        {
          timeout: 100,
        }
      )
    }, H.lib.TransactionFailedError)
    assert.equal(numAttempts, 1)

    numAttempts = 0
    try {
      await H.c.transactions().run(
        async (attempt) => {
          numAttempts++
          await attempt.insert(H.co, testDocIns, { foo: 'baz' })
        },
        {
          timeout: 100,
        }
      )
    } catch (err) {
      assert.instanceOf(err, H.lib.TransactionFailedError)
      assert.instanceOf(err.cause, H.lib.DocumentExistsError)
      assert.isTrue(err.cause.message.includes('document exists'))
      assert(
        err.context instanceof H.lib.KeyValueErrorContext ||
          typeof err.context === 'undefined'
      )
    }
    assert.equal(numAttempts, 1)
  })

  it('should raise ParsingFailureError only in lambda', async function () {
    const testDocIns = H.genTestKey()

    await H.co.insert(testDocIns, { foo: 'bar' })

    let numAttempts = 0
    await H.throwsHelper(async () => {
      await H.c.transactions().run(
        async (attempt) => {
          numAttempts++

          await H.throwsHelper(async () => {
            await attempt.query('This is not N1QL')
          }, H.lib.ParsingFailureError)

          throw new Error('success')
        },
        {
          timeout: 100,
        }
      )
    }, H.lib.TransactionFailedError)
    assert.equal(numAttempts, 1)

    numAttempts = 0
    try {
      await H.c.transactions().run(
        async (attempt) => {
          numAttempts++
          await attempt.query('This is not N1QL')
        },
        {
          timeout: 100,
        }
      )
    } catch (err) {
      assert.instanceOf(err, H.lib.TransactionFailedError)
      assert.instanceOf(err.cause, H.lib.ParsingFailureError)
      assert.isTrue(err.cause.message.includes('parsing failure'))
      assert(
        err.context instanceof H.lib.QueryErrorContext ||
          typeof err.context === 'undefined'
      )
    }
    assert.equal(numAttempts, 1)
  })
})
