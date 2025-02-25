import { HDKey } from 'ethereum-cryptography/hdkey.js'

import { Wallet } from './wallet.js'

export class EthereumHDKey {
  /**
   * Creates an instance based on a seed.
   *
   * For the seed we suggest to use [bip39](https://npmjs.org/package/bip39) to
   * create one from a BIP39 mnemonic.
   */
  public static fromMasterSeed(seedBuffer: Uint8Array): EthereumHDKey {
    return new EthereumHDKey(HDKey.fromMasterSeed(seedBuffer))
  }

  /**
   * Create an instance based on a BIP32 extended private or public key.
   */
  public static fromExtendedKey(base58Key: string): EthereumHDKey {
    return new EthereumHDKey(HDKey.fromExtendedKey(base58Key))
  }

  constructor(private readonly _hdkey: HDKey) {}

  /**
   * Returns a BIP32 extended private key (xprv)
   */
  public privateExtendedKey(): string {
    if (!this._hdkey.privateExtendedKey) {
      throw new Error('This is a public key only wallet')
    }
    return this._hdkey.privateExtendedKey
  }

  /**
   * Return a BIP32 extended public key (xpub)
   */
  public publicExtendedKey(): string {
    return this._hdkey.publicExtendedKey
  }

  /**
   * Derives a node based on a path (e.g. m/44'/0'/0/1)
   */
  public derivePath(path: string): EthereumHDKey {
    return new EthereumHDKey(this._hdkey.derive(path))
  }

  /**
   * Derive a node based on a child index
   */
  public deriveChild(index: number): EthereumHDKey {
    return new EthereumHDKey(this._hdkey.deriveChild(index))
  }

  /**
   * Return a `Wallet` instance as seen above
   */
  public getWallet(): Wallet {
    if (this._hdkey.privateKey) {
      return Wallet.fromPrivateKey(this._hdkey.privateKey)
    }
    if (!this._hdkey.publicKey) throw new Error('No hdkey')
    return Wallet.fromPublicKey(this._hdkey.publicKey, true)
  }
}
