type _Validity<V> =
  | V
  | readonly _Validity<V>[]
  | { [key: PropertyKey]: _Validity<V> }
  | (() => _Validity<V>);

export type Valid = _Validity<void>;
type Validity = _Validity<void | _Invalid<any>>;

declare class _Invalid<_Msg> {
  private _;
}

type FlattenMessage<A extends unknown[]> =
  A extends (
    [
      (infer First extends string) | _Name<infer First>,
      (infer Second extends string) | _Name<infer Second>,
      ...infer Rest,
    ]
  ) ?
    FlattenMessage<[`${First} ${Second}`, ...Rest]>
  : A extends [infer First, ...infer Rest] ? [First, ...FlattenMessage<Rest>]
  : A;

export type Invalid<Msg> =
  Msg extends [...infer _M] ? _Invalid<[...FlattenMessage<[..._M]>]> : _Invalid<Msg>;

interface TypeAssertContext {
  Satisfies<T, A extends TypeAssertion<T>>(this: void): Satisfies<T, A>;
  <const T>(this: void, value: T): CommonAssertions<T, UnchangedTypeAssertion>;
  Variable<const V extends { [k: string]: any }>(this: void, value: V): CommonAssertions<V, ForVariable>;
}

export function TypeAssert(_: (cx: TypeAssertContext) => Valid) {}

type PropsOf<T> = T extends { [_K in keyof T]: infer V extends T[keyof T] } ? V : T[keyof T];

type TargetSatisfies<A1 extends TypeAssertion, A2 extends TypeAssertion> = _Satisfies<
  Target<A1>,
  A2,
  Name<A1>
>;

export interface All<A extends readonly TypeAssertion[]> extends TypeAssertion<BaseTarget<A[number]>> {
  assert: { [K in keyof A]: TargetSatisfies<this, A[K]> };
}

export interface Extends<Super> extends TypeAssertion {
  assert: Target<this> extends Super ? void : Invalid<['expected', Name<this>, 'to extend', Super]>;
  invert: Target<this> extends Super ? Invalid<['expected', Name<this>, 'not to extend', Super]> : void;
}

type _SameType<A, B, _True = true, _False = false> =
  (<T>() => T extends A ? true : false) extends <T>() => T extends B ? true : false ? _True : _False;

export type SameType<A, B> = _SameType<
  A,
  B,
  Valid,
  Invalid<['expected', A, 'and', B, 'to be the same type']>
>;

type AssumeSubtype<Super, Sub> = Sub extends infer _Sub extends Super ? Sub & _Sub : Sub & Super;
type EnforceSubtype<Super, Sub extends Super> = AssumeSubtype<Super, Sub>;

type BaseTarget<A extends TypeFunctionBase<never>> = A extends TypeFunctionBase<infer B> ? B : never;

type Target<A extends TypeFunctionBase<never>> = EnforceSubtype<
  BaseTarget<A>,
  AssumeSubtype<BaseTarget<A>, A[typeof _target]>
>;

type ApplyTypeFunction<F extends TypeFunction<K, X>, K extends keyof F, X> = (F & {
  readonly [_target]: X;
})[K];

declare const _name: unique symbol;

interface _Name<S extends string> {
  [_name]: S;
}

interface _Named<S> {
  [_targetName]: S;
}

type Name<A extends TypeAssertion> = A extends _Named<infer S> ? S : Target<A>;

declare const _target: unique symbol;
declare const _targetName: unique symbol;
declare const _targetBase: unique symbol;

interface Contravariant<in T> {
  _contra: Contravariant<T>;
}

interface TypeAssertion<in Base = any> extends TypeFunction<'assert', Base, Validity> {
  readonly [_target]: unknown;

  readonly assert: Validity | Invalid<['missing assertion']>;
}

interface For<T, Name = T> {
  readonly [_target]: T;
  readonly [_targetName]: Name;
}

type _Satisfies<T, A extends TypeAssertion, Name = T> = EnforceSubtype<
  Validity,
  (For<T, Name> & A)['assert']
>;
type Satisfies<T, A extends TypeAssertion<T>> = _Satisfies<T, A>;

type VariableSatisfies<
  V extends { [k: string]: any },
  A extends TypeAssertion<PropsOf<V>>,
> = EnforceSubtype<
  Validity,
  PropsOf<{ [K in keyof V]: _Satisfies<V[K], A, K extends string ? _Name<`typeof ${K}`> : V[K]> }>
>;

interface TypeAssertionWithInversion extends TypeAssertion {
  invert: Valid | Invalid<['missing inverted assertion']>;
}

interface Not<A extends TypeAssertion> extends TypeAssertion<BaseTarget<A>> {
  assert: A extends TypeAssertionWithInversion ? (For<Target<this>, Name<this>> & A)['invert']
  : Satisfies<Target<this>, A> extends Valid ? Invalid<['expected', Name<this>, 'to fail', A]>
  : Valid;
  invert: TargetSatisfies<this, A>;
}

interface VariableObj<T = any> {
  readonly [k: string]: T;
}

interface Variable<A extends TypeAssertion> extends TypeAssertion<VariableObj<BaseTarget<A>>> {
  assert: VariableSatisfies<Target<this>, A>;
  invert: VariableSatisfies<Target<this>, Not<A>>;
}

interface TypeFunctionBase<in InBase> {
  readonly [_target]: unknown;
  readonly [_targetBase]: Contravariant<InBase>;
}

type TypeFunctionOutput<K extends PropertyKey, out OutBase> = { readonly [_ in K]: OutBase };

type TypeFunction<K extends PropertyKey, InBase = any, OutBase = any> = TypeFunctionBase<InBase>
  & TypeFunctionOutput<K, OutBase>;

interface TypeAssertionTransform<A extends TypeAssertion = TypeAssertion> extends TypeFunction<
  'assertion',
  A,
  TypeAssertion
> {
  assertion: TypeAssertion;
}

interface UnchangedTypeAssertion extends TypeAssertionTransform {
  assertion: Target<this>;
}

interface ForVariable extends TypeAssertionTransform {
  assertion: Variable<Target<this>>;
}

interface InvertAssertion extends TypeAssertionTransform {
  assertion: Not<Target<this>>;
}

interface ComposeTypeAssertionTransform<
  A extends TypeAssertionTransform,
  B extends TypeAssertionTransform<A['assertion']>,
> extends TypeAssertionTransform<BaseTarget<A>> {
  assertion: TransformTypeAssertion<TransformTypeAssertion<Target<this>, B>, A>;
}

type TransformTypeAssertion<
  A extends TypeAssertion,
  F extends TypeAssertionTransform<A>,
> = ApplyTypeFunction<F, 'assertion', A>;

interface CommonAssertions<T, F extends TypeAssertionTransform> {
  Satisfies<A extends TypeAssertion<T>>(this: void): Satisfies<T, TransformTypeAssertion<A, F>>;
  Extends<Super>(this: void): Satisfies<T, TransformTypeAssertion<Extends<Super>, F>>;
  Not: CommonAssertions<T, ComposeTypeAssertionTransform<InvertAssertion, F>>;
}
