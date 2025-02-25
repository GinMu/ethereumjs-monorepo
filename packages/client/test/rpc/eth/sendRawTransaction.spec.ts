import { BlockHeader } from '@ethereumjs/block'
import { Chain, Common, Hardfork } from '@ethereumjs/common'
import { DefaultStateManager } from '@ethereumjs/statemanager'
import {
  BlobEIP4844Transaction,
  FeeMarketEIP1559Transaction,
  LegacyTransaction,
} from '@ethereumjs/tx'
import {
  Account,
  blobsToCommitments,
  bytesToHex,
  commitmentsToVersionedHashes,
  getBlobs,
  hexToBytes,
  initKZG,
  randomBytes,
} from '@ethereumjs/util'
import * as kzg from 'c-kzg'
import { assert, describe, it } from 'vitest'

import { INTERNAL_ERROR, INVALID_PARAMS, PARSE_ERROR } from '../../../src/rpc/error-code'
import { baseRequest, baseSetup, params } from '../helpers'
import { checkError } from '../util'

import type { FullEthereumService } from '../../../src/service'

const method = 'eth_sendRawTransaction'

describe(method, () => {
  it('call with valid arguments', async () => {
    // Disable stateroot validation in TxPool since valid state root isn't available
    const originalSetStateRoot = DefaultStateManager.prototype.setStateRoot
    const originalStateManagerCopy = DefaultStateManager.prototype.shallowCopy
    DefaultStateManager.prototype.setStateRoot = function (): any {}
    DefaultStateManager.prototype.shallowCopy = function () {
      return this
    }
    const common = new Common({ chain: Chain.Mainnet })
    common
      .hardforks()
      .filter((hf) => hf.timestamp !== undefined)
      .map((hf) => {
        hf.timestamp = undefined
      })
    const syncTargetHeight = common.hardforkBlock(Hardfork.London)
    const { server, client } = baseSetup({ syncTargetHeight, includeVM: true })

    // Mainnet EIP-1559 tx
    const txData =
      '0x02f90108018001018402625a0094cccccccccccccccccccccccccccccccccccccccc830186a0b8441a8451e600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f85bf859940000000000000000000000000000000000000101f842a00000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000060a701a0afb6e247b1c490e284053c87ab5f6b59e219d51f743f7a4d83e400782bc7e4b9a0479a268e0e0acd4de3f1e28e4fac2a6b32a4195e8dfa9d19147abe8807aa6f64'
    const transaction = FeeMarketEIP1559Transaction.fromSerializedTx(hexToBytes(txData))
    const address = transaction.getSenderAddress()
    const vm = (client.services.find((s) => s.name === 'eth') as FullEthereumService).execution.vm

    await vm.stateManager.putAccount(address, new Account())
    const account = await vm.stateManager.getAccount(address)
    account!.balance = BigInt('40100000')
    await vm.stateManager.putAccount(address, account!)

    const req = params(method, [txData])
    const expectRes = (res: any) => {
      const msg = 'should return the correct tx hash'
      assert.equal(
        res.body.result,
        '0xd7217a7d3251880051783f305a3536e368c604aa1f1602e6cd107eb7b87129da',
        msg
      )
    }
    await baseRequest(server, req, 200, expectRes)
    // Restore setStateRoot
    DefaultStateManager.prototype.setStateRoot = originalSetStateRoot
    DefaultStateManager.prototype.shallowCopy = originalStateManagerCopy
  })

  it('send local tx with gasprice lower than minimum', async () => {
    // Disable stateroot validation in TxPool since valid state root isn't available
    const originalSetStateRoot = DefaultStateManager.prototype.setStateRoot
    DefaultStateManager.prototype.setStateRoot = (): any => {}
    const syncTargetHeight = new Common({ chain: Chain.Mainnet }).hardforkBlock(Hardfork.London)
    const { server } = baseSetup({ syncTargetHeight, includeVM: true })

    const transaction = LegacyTransaction.fromTxData({
      gasLimit: 21000,
      gasPrice: 0,
      nonce: 0,
    }).sign(hexToBytes('0x' + '42'.repeat(32)))

    const txData = bytesToHex(transaction.serialize())

    const req = params(method, [txData])
    const expectRes = (res: any) => {
      assert.equal(
        res.body.result,
        '0xf6798d5ed936a464ef4f49dd5a3abe1ad6947364912bd47c5e56781125d44ac3',
        'local tx with lower gasprice than minimum gasprice added to pool'
      )
    }
    await baseRequest(server, req, 200, expectRes)

    // Restore setStateRoot
    DefaultStateManager.prototype.setStateRoot = originalSetStateRoot
  })

  it('call with invalid arguments: not enough balance', async () => {
    // Disable stateroot validation in TxPool since valid state root isn't available
    const originalSetStateRoot = DefaultStateManager.prototype.setStateRoot
    DefaultStateManager.prototype.setStateRoot = (): any => {}
    const syncTargetHeight = new Common({ chain: Chain.Mainnet }).hardforkBlock(Hardfork.London)
    const { server } = baseSetup({ syncTargetHeight, includeVM: true })

    // Mainnet EIP-1559 tx
    const txData =
      '0x02f90108018001018402625a0094cccccccccccccccccccccccccccccccccccccccc830186a0b8441a8451e600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f85bf859940000000000000000000000000000000000000101f842a00000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000060a701a0afb6e247b1c490e284053c87ab5f6b59e219d51f743f7a4d83e400782bc7e4b9a0479a268e0e0acd4de3f1e28e4fac2a6b32a4195e8dfa9d19147abe8807aa6f64'

    const req = params(method, [txData])
    const expectRes = checkError(INVALID_PARAMS, 'insufficient balance')
    await baseRequest(server, req, 200, expectRes)

    // Restore setStateRoot
    DefaultStateManager.prototype.setStateRoot = originalSetStateRoot
  })

  it('call with sync target height not set yet', async () => {
    const { server, client } = baseSetup()
    client.config.synchronized = false

    // Mainnet EIP-1559 tx
    const txData =
      '0x02f90108018001018402625a0094cccccccccccccccccccccccccccccccccccccccc830186a0b8441a8451e600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f85bf859940000000000000000000000000000000000000101f842a00000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000060a701a0afb6e247b1c490e284053c87ab5f6b59e219d51f743f7a4d83e400782bc7e4b9a0479a268e0e0acd4de3f1e28e4fac2a6b32a4195e8dfa9d19147abe8807aa6f64'
    const req = params(method, [txData])

    const expectRes = checkError(
      INTERNAL_ERROR,
      'client is not aware of the current chain height yet (give sync some more time)'
    )
    await baseRequest(server, req, 200, expectRes)
  })

  it('call with invalid tx (wrong chain ID)', async () => {
    const syncTargetHeight = new Common({ chain: Chain.Mainnet }).hardforkBlock(Hardfork.London)
    const { server } = baseSetup({ syncTargetHeight, includeVM: true })

    // Baikal EIP-1559 tx
    const txData =
      '0x02f9010a82066a8001018402625a0094cccccccccccccccccccccccccccccccccccccccc830186a0b8441a8451e600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f85bf859940000000000000000000000000000000000000101f842a00000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000060a701a0afb6e247b1c490e284053c87ab5f6b59e219d51f743f7a4d83e400782bc7e4b9a0479a268e0e0acd4de3f1e28e4fac2a6b32a4195e8dfa9d19147abe8807aa6f64'
    const req = params(method, [txData])

    const expectRes = checkError(PARSE_ERROR, 'serialized tx data could not be parsed')
    await baseRequest(server, req, 200, expectRes)
  })

  it('call with unsigned tx', async () => {
    const syncTargetHeight = new Common({ chain: Chain.Mainnet }).hardforkBlock(Hardfork.London)
    const { server } = baseSetup({ syncTargetHeight })

    // Mainnet EIP-1559 tx
    const txData =
      '0x02f90108018001018402625a0094cccccccccccccccccccccccccccccccccccccccc830186a0b8441a8451e600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f85bf859940000000000000000000000000000000000000101f842a00000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000060a701a0afb6e247b1c490e284053c87ab5f6b59e219d51f743f7a4d83e400782bc7e4b9a0479a268e0e0acd4de3f1e28e4fac2a6b32a4195e8dfa9d19147abe8807aa6f64'
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.London })
    const tx = FeeMarketEIP1559Transaction.fromSerializedTx(hexToBytes(txData), {
      common,
      freeze: false,
    })
    ;(tx as any).v = undefined
    ;(tx as any).r = undefined
    ;(tx as any).s = undefined
    const txHex = bytesToHex(tx.serialize())
    const req = params(method, [txHex])

    const expectRes = checkError(INVALID_PARAMS, 'tx needs to be signed')
    await baseRequest(server, req, 200, expectRes)
  })

  it('call with no peers', async () => {
    // Disable stateroot validation in TxPool since valid state root isn't available
    const originalSetStateRoot = DefaultStateManager.prototype.setStateRoot
    DefaultStateManager.prototype.setStateRoot = (): any => {}
    const originalStateManagerCopy = DefaultStateManager.prototype.shallowCopy
    DefaultStateManager.prototype.shallowCopy = function () {
      return this
    }
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.London })

    const syncTargetHeight = common.hardforkBlock(Hardfork.London)
    const { server, client } = baseSetup({
      commonChain: common,
      syncTargetHeight,
      includeVM: true,
      noPeers: true,
    })

    // Mainnet EIP-1559 tx
    const txData =
      '0x02f90108018001018402625a0094cccccccccccccccccccccccccccccccccccccccc830186a0b8441a8451e600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f85bf859940000000000000000000000000000000000000101f842a00000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000060a701a0afb6e247b1c490e284053c87ab5f6b59e219d51f743f7a4d83e400782bc7e4b9a0479a268e0e0acd4de3f1e28e4fac2a6b32a4195e8dfa9d19147abe8807aa6f64'
    const transaction = FeeMarketEIP1559Transaction.fromSerializedTx(hexToBytes(txData))
    const address = transaction.getSenderAddress()
    const vm = (client.services.find((s) => s.name === 'eth') as FullEthereumService).execution.vm

    await vm.stateManager.putAccount(address, new Account())
    const account = await vm.stateManager.getAccount(address)
    account!.balance = BigInt('40100000')
    await vm.stateManager.putAccount(address, account!)

    const req = params(method, [txData])

    const expectRes = checkError(INTERNAL_ERROR, 'no peer connection available')
    await baseRequest(server, req, 200, expectRes)

    // Restore setStateRoot
    DefaultStateManager.prototype.setStateRoot = originalSetStateRoot
    DefaultStateManager.prototype.shallowCopy = originalStateManagerCopy
  })

  it('blob EIP 4844 transaction', async () => {
    // Disable stateroot validation in TxPool since valid state root isn't available
    const originalSetStateRoot = DefaultStateManager.prototype.setStateRoot
    DefaultStateManager.prototype.setStateRoot = (): any => {}
    const originalStateManagerCopy = DefaultStateManager.prototype.shallowCopy
    DefaultStateManager.prototype.shallowCopy = function () {
      return this
    }
    // Disable block header consensus format validation
    const consensusFormatValidation = BlockHeader.prototype['_consensusFormatValidation']
    BlockHeader.prototype['_consensusFormatValidation'] = (): any => {}
    try {
      initKZG(kzg, __dirname + '/../../../src/trustedSetups/devnet6.txt')
      // eslint-disable-next-line
    } catch {}
    const gethGenesis = require('../../../../block/test/testdata/4844-hardfork.json')
    const common = Common.fromGethGenesis(gethGenesis, {
      chain: 'customChain',
      hardfork: Hardfork.Cancun,
    })
    common.setHardfork(Hardfork.Cancun)
    const { server, client } = baseSetup({
      commonChain: common,
      includeVM: true,
      syncTargetHeight: 100n,
    })
    const blobs = getBlobs('hello world')
    const commitments = blobsToCommitments(blobs)
    const versionedHashes = commitmentsToVersionedHashes(commitments)
    const proofs = blobs.map((blob, ctx) => kzg.computeBlobKzgProof(blob, commitments[ctx]))
    const pk = randomBytes(32)
    const tx = BlobEIP4844Transaction.fromTxData(
      {
        versionedHashes,
        blobs,
        kzgCommitments: commitments,
        kzgProofs: proofs,
        maxFeePerBlobGas: 1000000n,
        gasLimit: 0xffffn,
        maxFeePerGas: 10000000n,
        maxPriorityFeePerGas: 1000000n,
        to: randomBytes(20),
      },
      { common }
    ).sign(pk)

    const replacementTx = BlobEIP4844Transaction.fromTxData(
      {
        versionedHashes,
        blobs,
        kzgCommitments: commitments,
        kzgProofs: proofs,
        maxFeePerBlobGas: 1000000n,
        gasLimit: 0xfffffn,
        maxFeePerGas: 100000000n,
        maxPriorityFeePerGas: 10000000n,
        to: randomBytes(20),
      },
      { common }
    ).sign(pk)
    const vm = (client.services.find((s) => s.name === 'eth') as FullEthereumService).execution.vm
    await vm.stateManager.putAccount(tx.getSenderAddress(), new Account())
    const account = await vm.stateManager.getAccount(tx.getSenderAddress())
    account!.balance = BigInt(0xfffffffffffff)
    await vm.stateManager.putAccount(tx.getSenderAddress(), account!)

    const req = params(method, [bytesToHex(tx.serializeNetworkWrapper())])
    const req2 = params(method, [bytesToHex(replacementTx.serializeNetworkWrapper())])
    const expectRes = (res: any) => {
      assert.equal(res.body.error, undefined, 'initial blob transaction accepted')
    }

    const expectRes2 = checkError(INVALID_PARAMS, 'replacement blob gas too low')

    await baseRequest(server, req, 200, expectRes, false)
    await baseRequest(server, req2, 200, expectRes2)

    // Restore stubbed out functionality
    DefaultStateManager.prototype.setStateRoot = originalSetStateRoot
    DefaultStateManager.prototype.shallowCopy = originalStateManagerCopy
    BlockHeader.prototype['_consensusFormatValidation'] = consensusFormatValidation
  })
})
