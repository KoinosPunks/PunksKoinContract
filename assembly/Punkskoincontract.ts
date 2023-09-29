import {
  Arrays,
  Protobuf,
  System,
  SafeMath,
  Storage,
  authority,
  error,
  value,
  Crypto,
} from "@koinos/sdk-as";
import { punkskoincontract } from "./proto/punkskoincontract";

const SUPPLY_SPACE_ID = 0;
const BALANCES_SPACE_ID = 1;
const ALLOWANCES_SPACE_ID = 2;


export class Punkskoincontract {
  _contractId: Uint8Array;


  // set _maxSupply to zero if there is no max supply
  // if set to zero, the supply would still be limited by how many tokens can fit in a u64 (u64.MAX_VALUE)
  _maxSupply: u64 = 2100000000000000;


  _name: string = "PunksKoin";
  _symbol: string = "PUNKSK";
  _decimals: u32 = 8;
  _supply!: Storage.Obj<punkskoincontract.balance_object>;
  _balances!: Storage.Map<Uint8Array, punkskoincontract.balance_object>;
  _allowances!: Storage.Map<Uint8Array, punkskoincontract.uint64>;


  constructor() {
    this._contractId = System.getContractId();
    this._supply = new Storage.Obj(
      this._contractId,
      SUPPLY_SPACE_ID,
      punkskoincontract.balance_object.decode,
      punkskoincontract.balance_object.encode,
      () => new punkskoincontract.balance_object(0)
    );
    this._balances = new Storage.Map(
      this._contractId,
      BALANCES_SPACE_ID,
      punkskoincontract.balance_object.decode,
      punkskoincontract.balance_object.encode,
      () => new punkskoincontract.balance_object(0)
    );
    this._allowances = new Storage.Map(
      this._contractId,
      ALLOWANCES_SPACE_ID,
      punkskoincontract.uint64.decode,
      punkskoincontract.uint64.encode,
      null
    );
  }

  /**
   * Get name of the token
   * @external
   * @readonly
   */
  name(args: punkskoincontract.name_arguments): punkskoincontract.name_result {
    return new punkskoincontract.name_result(this._name);
  }

  /**
   * Get the symbol of the token
   * @external
   * @readonly
   */
  symbol(args: punkskoincontract.symbol_arguments): punkskoincontract.symbol_result {
    return new punkskoincontract.symbol_result(this._symbol);
  }

  /**
   * Get the decimals of the token
   * @external
   * @readonly
   */
  decimals(
    args: punkskoincontract.decimals_arguments
  ): punkskoincontract.decimals_result {
    return new punkskoincontract.decimals_result(this._decimals);
  }

  /**
   * Get total supply
   * @external
   * @readonly
   */
  total_supply(
    args: punkskoincontract.total_supply_arguments
  ): punkskoincontract.total_supply_result {
    const supply = this._supply.get()!;

    const res = new punkskoincontract.total_supply_result();
    res.value = supply.value;

    return res;
  }

  /**
   * Get balance of an account
   * @external
   * @readonly
   */
  balance_of(
    args: punkskoincontract.balance_of_arguments
  ): punkskoincontract.balance_of_result {
    const owner = args.owner!;

    const balanceObj = this._balances.get(owner)!;

    const res = new punkskoincontract.balance_of_result();
    res.value = balanceObj.value;

    return res;
  }

  /**
   * Retrieves the allowance granted by an owner to a spender.
   * @external
   * @readonly
   */
  allowance(
    args: punkskoincontract.allowance_arguments
  ): punkskoincontract.allowance_result {
    const key = new Uint8Array(50);
    key.set(args.owner, 0);
    key.set(args.spender, 25);
    const allowance = this._allowances.get(key);
    if (!allowance) return new punkskoincontract.allowance_result(0);
    return new punkskoincontract.allowance_result(allowance.value);
  }

  /**
   * Retrieves the signers associated with the current transaction.
   * @returns {Array<Uint8Array>} An array of signer addresses.
   */
  getSigners(): Array<Uint8Array> {
    const sigBytes =
      System.getTransactionField("signatures")!.message_value!.value!;
    const signatures = Protobuf.decode<value.list_type>(
      sigBytes,
      value.list_type.decode
    );
    const txId = System.getTransactionField("id")!.bytes_value;
    const signers: Array<Uint8Array> = [];
    for (let i = 0; i < signatures.values.length; i++) {
      const publicKey = System.recoverPublicKey(
        signatures.values[i].bytes_value,
        txId
      );
      const address = Crypto.addressFromPublicKey(publicKey!);
      signers.push(address);
    }
    return signers;
  }

  /**
   * Checks the authority for a specific account based on the provided parameters.
   * @param {Uint8Array} account - The account to check authority for.
   * @param {boolean} acceptAllowances - Indicates whether to consider allowances in the authority check.
   * @param {u64} amount - The amount involved in the authority check.
   * @returns {boolean} Returns true if the account has authority; otherwise, returns false.
   */
  private check_authority(
    account: Uint8Array,
    acceptAllowances: boolean,
    amount: u64
  ): bool {
    const caller = System.getCaller();

    const key = new Uint8Array(50);
    if (acceptAllowances) {
      key.set(account, 0);
    }

    // check if there is a caller (smart contract in the middle)
    if (caller.caller && caller.caller.length > 0) {
      if (acceptAllowances) {
        // check if the caller is approved for all tokens
        key.set(caller.caller, 25);
        const allowance = this._allowances.get(key);
        if (allowance && allowance.value >= amount) {
          // spend allowance
          allowance.value -= amount;
          this._allowances.put(key, allowance);
          return true;
        }
      }

      // check if the account is the caller
      if (Arrays.equal(account, caller.caller)) return true;

      // the transaction has a caller but none of the different
      // options authorized the operation, then it is rejected.
      return false;
    }

    // check the signatures related to allowances
    const signers = this.getSigners();

    // there is no caller, no approval from allowances, and the account
    // doesn't have a contract then check if the account signed the transaction
    for (let i = 0; i < signers.length; i += 1) {
      if (Arrays.equal(account, signers[i])) return true;
    }

    // none of the different options authorized the operation,
    // then it is rejected.
    return false;
  }

  /**
   * Approves the spender to transfer a specific amount of tokens on behalf of the owner.
   * @param {punkskoincontract.approve_arguments} args - The arguments for the approval operation.
   * @returns {void}
   */
  _approve(args: punkskoincontract.approve_arguments): void {
    const key = new Uint8Array(50);
    key.set(args.owner, 0);
    key.set(args.spender, 25);
    this._allowances.put(key, new punkskoincontract.uint64(args.value));

    const impacted = [args.spender, args.owner];
    const approveEvent = new punkskoincontract.approve_event(
      args.owner,
      args.spender,
      args.value
    );
    System.event(
      "punkskoincontract.approve_event",
      Protobuf.encode<punkskoincontract.approve_event>(
        approveEvent,
        punkskoincontract.approve_event.encode
      ),
      impacted
    );
  }

  /**
   * Approves the spender to transfer a specific amount of tokens on behalf of the owner.
   * @param {punkskoincontract.approve_arguments} args - The arguments for the approval operation.
   * @returns {punkskoincontract.empty_message}
   */
  approve(
    args: punkskoincontract.approve_arguments
  ): punkskoincontract.empty_message {
    const isAuthorized = this.check_authority(args.owner, false, 0);
    System.require(isAuthorized, "approve operation not authorized");
    this._approve(args);
    return new punkskoincontract.empty_message();
  }

  /**
   * Transfer tokens
   * @external
   */
  transfer(
    args: punkskoincontract.transfer_arguments
  ): punkskoincontract.empty_message {
    const from = args.from!;
    const to = args.to!;
    const value = args.value;

    System.require(!Arrays.equal(from, to), "Cannot transfer to self");

    const isAuthorized = this.check_authority(from, true, value);
    System.require(
      isAuthorized,
      "'from' has not authorized transfer",
      error.error_code.authorization_failure
    );

    const fromBalance = this._balances.get(from)!;

    System.require(
      fromBalance.value >= value,
      "'from' has insufficient balance"
    );

    const toBalance = this._balances.get(to)!;

    // the balances cannot hold more than the supply, so we don't check for overflow/underflow
    fromBalance.value -= value;
    toBalance.value += value;

    this._balances.put(from, fromBalance);
    this._balances.put(to, toBalance);

    const transferEvent = new punkskoincontract.transfer_event(
      from,
      to,
      value,
      fromBalance.value,
      toBalance.value
    );
    const impacted = [to, from];

    System.event(
      "punkskoincontract.transfer_event",
      Protobuf.encode(transferEvent, punkskoincontract.transfer_event.encode),
      impacted
    );

    return new punkskoincontract.empty_message();
  }

  /**
   * Mint new tokens
   * @external
   */
  mint(args: punkskoincontract.mint_arguments): punkskoincontract.empty_message {
    const to = args.to!;
    const value = args.value;

    const isAuthorized = this.check_authority(this._contractId, false, 0);
    System.require(isAuthorized, "mint operation not authorized");

    const supply = this._supply.get()!;

    const newSupply = SafeMath.tryAdd(supply.value, value);

    System.require(!newSupply.error, "Mint would overflow supply");
    
    System.require(this._maxSupply == 0 || newSupply.value <= this._maxSupply, 'Mint would overflow max supply');

    const toBalance = this._balances.get(to)!;
    toBalance.value += value;

    supply.value = newSupply.value;

    this._supply.put(supply);
    this._balances.put(to, toBalance);

    const mintEvent = new punkskoincontract.mint_event(to, value);
    const impacted = [to];

    System.event(
      "punkskoincontract.mint_event",
      Protobuf.encode(mintEvent, punkskoincontract.mint_event.encode),
      impacted
    );

    return new punkskoincontract.empty_message();
  }

  /**
   * Burn tokens
   * @external
   */
  burn(args: punkskoincontract.burn_arguments): punkskoincontract.empty_message {
    const from = args.from!;
    const value = args.value;

    const isAuthorized = this.check_authority(this._contractId, false, 0);
    System.require(isAuthorized, "burn operation not authorized");

    const fromBalance = this._balances.get(from)!;

    System.require(
      fromBalance.value >= value,
      "'from' has insufficient balance"
    );

    const supply = this._supply.get()!;

    const newSupply = SafeMath.sub(supply.value, value);

    supply.value = newSupply;
    fromBalance.value -= value;

    this._supply.put(supply);
    this._balances.put(from, fromBalance);

    const burnEvent = new punkskoincontract.burn_event(from, value);
    const impacted = [from];

    System.event(
      "punkskoincontract.burn_event",
      Protobuf.encode(burnEvent, punkskoincontract.burn_event.encode),
      impacted
    );

    return new punkskoincontract.empty_message();
  }

 
}
