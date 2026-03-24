type _Validity<V> = V | readonly _Validity<V>[] | { [key: string]: _Validity<V> } | (() => _Validity<V>);

export type Valid = _Validity<void>;
export type Validity = _Validity<void | _Invalid<any>>;
export type IfValid<V extends Validity, T> = [V] extends [Valid] ? T : V;
export type IfSatisfies<X, A extends TypeAssertion<X>, T> = IfValid<Satisfies<X, A>, T>;

declare class _Invalid<_Msg> {
  private _;
}

export type TypeAssertions<Base = any> =
  | TypeAssertion<Base>
  | readonly TypeAssertions<Base>[]
  | { [k: string]: TypeAssertions<Base> };

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

interface TypeAssertWithKnownTypeFunction<T, F extends TypeAssertionTransform = UnchangedTypeAssertion> {
  (_: (assert: CommonAssertions<T, F>) => Valid): this;
}

interface TypeAssertValueFunction {
  <T>(value: T, _?: (assert: CommonAssertions<T>) => Valid): NoInfer<TypeAssertWithKnownTypeFunction<T>>;
}

interface TypeAssertVariableFunction {
  <V extends { [k: string]: any }>(
    value: V,
    _?: (assert: CommonAssertions<V, ForVariable>) => Valid,
  ): NoInfer<TypeAssertWithKnownTypeFunction<V, ForVariable>>;
}

interface TypeAssertTypeFunction {
  <T>(_?: (assert: CommonAssertions<T>) => Valid): NoInfer<TypeAssertWithKnownTypeFunction<T>>;
}

export function TypeAssert<T>(
  _?: (assert: CommonAssertions<T>) => Valid,
): NoInfer<TypeAssertWithKnownTypeFunction<T>>;
export function TypeAssert<_NEVER extends never, T>(
  _: (cx: TypeAssertContext) => CommonAssertions<T>,
): NoInfer<TypeAssertWithKnownTypeFunction<T>>;
export function TypeAssert<_NEVER extends never, T>(
  value: T,
  _: (cx: TypeAssertContext) => CommonAssertions<T>,
): NoInfer<TypeAssertWithKnownTypeFunction<T>>;
export function TypeAssert(_: (cx: TypeAssertContext) => Valid): typeof TypeAssert;
export function TypeAssert() {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return TypeAssert as Function;
}

TypeAssert.Type = TypeAssert as TypeAssertTypeFunction;
TypeAssert.Value = TypeAssert as TypeAssertValueFunction;
TypeAssert.Variable = TypeAssert as unknown as TypeAssertVariableFunction;

TypeAssert.Function = <A extends TypeAssertion>() => ({
  calls: <Args extends readonly unknown[] = [], Ret = void>(
    body: <T extends BaseTarget<A>>(value: ImpliedIfValid<T, A>, ...args: Args) => Ret,
  ) =>
    body as <T extends BaseTarget<A>>(
      value: IfSatisfies<T, A, ImpliedIfInvalid<T, A>>,
      ...args: Args
    ) => Ret,
  with: <T, Args extends readonly unknown[] = [], Ret = void>(
    value: T,
    body: (value: ImpliedIfValid<T, A>, ...args: Args) => Ret,
  ) =>
    ((...args: Args) => body(value as ImpliedIfValid<T, A>, ...args)) as Satisfies<T, A> extends Valid ?
      (...args: Args) => Ret
    : (invalid: Satisfies<T, A>) => never,
});

interface _PrimitiveMarker<_T> {}
type _Primitive<T> = T & _PrimitiveMarker<T>;
type Primitive<T> = Extract<PropertyKey, T> extends never ? T : _Primitive<T>;

type KeysOf<T> = keyof { [K in keyof Exclude<T, never> as Primitive<K>]: any };
type PropsOf<T> = T[KeysOf<T>];
type TargetSatisfies<A1 extends MinimalTypeAssertion, A2 extends MinimalTypeAssertion> = _Satisfies<
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

  decides: [Super];
}

type _SameType<A, B, _True = true, _False = false> =
  (<T>() => T extends A ? true : false) extends <T>() => T extends B ? true : false ? _True : _False;

export type SameType<A, B> = _SameType<
  A,
  B,
  Valid,
  Invalid<['expected', A, 'and', B, 'to be the same type']>
>;

type _Subtype<Super, Sub extends Super> = Sub;

type AssumeSubtype<Super, Sub> = _Subtype<Super, Sub extends infer _Sub extends Super ? Sub & _Sub : never>;
type EnforceSubtype<Super, Sub extends Super> = AssumeSubtype<Super, Sub>;

type BaseTarget<A extends TypeFunctionBase<never>> = A extends TypeFunctionBase<infer B> ? B : never;

type Target<A extends TypeFunctionBase<never>> = EnforceSubtype<
  BaseTarget<A>,
  AssumeSubtype<BaseTarget<A>, A[typeof _target]>
>;

type ApplyTypeFunction<F extends TypeFunction<K, X>, K extends keyof F, X> = EnforceSubtype<
  F[K],
  (F & { readonly [_target]: X })[K]
>;

declare const _name: unique symbol;

interface _Name<S extends string> {
  [_name]: S;
}

interface _Named<S> {
  [_targetName]: S;
}

type Name<A extends MinimalTypeAssertion> = A extends _Named<infer S> ? S : Target<A>;

declare const _target: unique symbol;
declare const _targetName: unique symbol;
declare const _targetBase: unique symbol;

interface TypeMarker<T> {}

interface Bivariant<T> extends TypeMarker<T> {
  _bivariance(x: T): void;
}

interface Covariant<out T> extends Bivariant<T> {
  _covariant?: Covariant<T>;
}

interface Contravariant<in T> extends Bivariant<T> {
  _contravariant?: Contravariant<T>;
}

interface Invariant<in out T> extends Bivariant<T>, Covariant<T>, Contravariant<T> {}

type VarianceType<V extends TypeMarker<any>> = V extends TypeMarker<infer T> ? T : never;

type ImplicationsOf<Base, I> = {};

interface AllImplications<A extends ImplicationItem> {
  all: A;
}
interface AnyImplications<A extends ImplicationItem> {
  any: A;
}

type BaseImplication<K extends string, T> = { readonly [_ in K]: TypeMarker<T> };

interface ImpliesImplication<out T> {
  implies: Covariant<T>;
}

interface AllowsImplication<in T> {
  allows: Contravariant<T>;
}

interface DecidesImplication<in out T> {
  decides: Invariant<T>;
}

interface ImpliesNotImplication<in T> {
  impliesNot: Contravariant<T>;
}

interface AllowsNotImplication<out T> {
  allowsNot: Covariant<T>;
}

interface DecidesNotImplication<in out T> {
  decidesNot: Invariant<T>;
}

type InvertImplication<A extends ImplicationItem> = _Subtype<
  ImplicationItem,
  | (A extends AllImplications<infer A1> ? AnyImplications<InvertImplication<A1>> : never)
  | (A extends AnyImplications<infer A1> ? AllImplications<InvertImplication<A1>> : never)
  | (A extends readonly unknown[] ? A : never)
>;

type ImplicationItem =
  | readonly unknown[]
  | AllImplications<ImplicationItem>
  | AnyImplications<ImplicationItem>;

interface ImplicationsInput<in Base> {}

interface Implications<in Base> extends TypeFunctionBase<Base> {
  /** Target extends if valid */
  readonly implies: readonly unknown[];
  /** Target does not extend if not valid */
  readonly allows: readonly unknown[];
  /** Target extends if and only if valid (both implies and allows) */
  readonly decides: readonly unknown[];
  /** Target does not extend if valid */
  readonly impliesNot: readonly unknown[];
  /** Target extends if not valid */
  readonly allowsNot: readonly unknown[];
  /** Target extends if and only if not valid (both impliesNot and allowsNot) */
  readonly decidesNot: readonly unknown[];
}

interface ImpliesType<in T extends readonly unknown[]> {}

export interface TypeAssertion<in Base = any> extends TypeFunction<'assert', Base, Validity> {
  readonly [_target]: unknown;
  readonly assert: Validity | Invalid<['missing assertion']>;
  readonly implications: Implications<Base>;
}

interface For<T, Name = T> {
  readonly [_target]: T;
  readonly [_targetName]: Name;
}

interface MinimalTypeAssertion<in B = never> extends TypeFunctionBase<B> {
  assert: Validity;
}

type MinimalTypeAssertions<B = never> =
  | MinimalTypeAssertion<B>
  | readonly MinimalTypeAssertions<B>[]
  | { [k: string]: MinimalTypeAssertions<B> };

type _SatisfiesAssertion<T, A extends MinimalTypeAssertion, Name = T> = EnforceSubtype<
  Validity,
  (For<T, Name> & A)['assert']
>;

type _SatisfiesInternal<T, A, Name = T> = AssumeSubtype<
  Validity,
  A extends MinimalTypeAssertion ? EnforceSubtype<Validity, _SatisfiesAssertion<T, A, Name>>
  : A extends readonly unknown[] ? never
  : // AssumeSubtype<readonly Validity[], { [K in keyof A]: _SatisfiesInternal<T, A[K], Name> }>
    never
  // : AssumeSubtype<Validity, { [K in keyof A]: _SatisfiesInternal<T, A[K], Name> }>
>;

type _Satisfies<T, A extends MinimalTypeAssertions, Name = T> = AssumeSubtype<
  Validity,
  _SatisfiesInternal<T, A, Name>
>;

type Satisfies<T, A extends MinimalTypeAssertions<T>> = _Satisfies<T, A>;

type VariableSatisfies<
  V extends { [k: string]: any },
  A extends TypeAssertions<PropsOf<V>>,
> = EnforceSubtype<
  Validity,
  PropsOf<{ [K in keyof V]: _Satisfies<V[K], A, K extends string ? _Name<`typeof ${K}`> : V[K]> }>
>;

interface TypeAssertionWithInversion extends MinimalTypeAssertion {
  invert: Valid | Invalid<['missing inverted assertion']>;
}

export interface Not<
  A extends MinimalTypeAssertion<Base>,
  Base = BaseTarget<A>,
> extends TypeAssertion<Base> {
  assert: A extends TypeAssertionWithInversion ? (For<Target<this>, Name<this>> & A)['invert']
  : Satisfies<Target<this>, A> extends Valid ? Invalid<['expected', Name<this>, 'to fail', A]>
  : Valid;
  invert: TargetSatisfies<this, A>;
  implies: Implication<A, 'allowsNot'>;
  allows: Implication<A, 'impliesNot'>;
  decides: Implication<A, 'decidesNot'>;
  impliesNot: Implication<A, 'allows'>;
  allowsNot: Implication<A, 'implies'>;
  decidesNot: Implication<A, 'decides'>;
}

type SoftIntersect<A, B> =
  A extends infer _A extends B ? A & _A
  : B extends infer _B extends A ? B & _B
  : A & B;

type IntersectItems<T extends readonly Default[], Default = T[number]> =
  { readonly [K in keyof T]: Contravariant<T[K]> } extends (
    readonly Contravariant<infer X extends Default>[]
  ) ?
    X
  : Default;

type IntersectUnion<T extends Default, Default = T> =
  (T extends never ? never : Contravariant<T>) extends Contravariant<infer U extends Default> ? U : Default;

type _SoftIntersectUnion<T extends Default, Default, Others extends T = T> = IntersectItems<
  T extends infer _T extends IntersectUnion<Others> ? [T & _T]
  : (
    Others extends T ?
      T extends Others ?
        never
      : unknown
    : never
  ) extends never ?
    [T]
  : never,
  Default
>;
type SoftIntersectUnion<T extends Default, Default = T> = _SoftIntersectUnion<T, Default>;
type SoftIntersectItems<T extends readonly Default[], Default = T[number]> = SoftIntersectUnion<
  { [K in keyof T]: [T[K]] }[number],
  [Default]
>[0];

type ImpliedIfValid<T, A extends TypeAssertion, _A extends TypeAssertion = A & { [_target]: T }> = Exclude<
  SoftIntersect<T, SoftIntersectItems<_A['implies'] | _A['decides']>>,
  _A['impliesNot'][number] | _A['decidesNot'][number]
>;

type ImpliedIfInvalid<
  T,
  A extends TypeAssertion,
  _A extends TypeAssertion = A & { [_target]: T },
> = Exclude<
  SoftIntersect<T, SoftIntersectItems<_A['allowsNot'] | _A['decidesNot']>>,
  _A['allows'][number] | _A['decides'][number]
>;

interface VariableObj<T = any> {
  readonly [k: string]: T;
}

type ImpliesForVariable<
  This extends TypeFunctionBase<VariableObj<any>>,
  A extends TypeAssertion<any>,
  Field extends `${'implies' | 'allows' | 'decides'}${'Not' | ''}`,
  Base extends readonly unknown[] = (A & { [_target]: PropsOf<Target<This>> })[Field],
> = { [Idx in keyof Base]: { [K in keyof Target<This>]: Base[Idx] } };

interface Variable<A extends TypeAssertion> extends TypeAssertion<VariableObj<BaseTarget<A>>> {
  assert: VariableSatisfies<Target<this>, A>;
  invert: VariableSatisfies<Target<this>, Not<A>>;

  implies: ImpliesForVariable<this, A, 'implies'>;
  allows: ImpliesForVariable<this, A, 'allows'>;
  decides: ImpliesForVariable<this, A, 'decides'>;
  impliesNot: ImpliesForVariable<this, A, 'impliesNot'>;
  allowsNot: ImpliesForVariable<this, A, 'allowsNot'>;
  decidesNot: ImpliesForVariable<this, A, 'decidesNot'>;
}

interface TypeFunctionBase<in InBase> {
  readonly [_target]: unknown;
  readonly [_targetBase]: Contravariant<InBase>;
}

type TypeFunctionOutput<K extends PropertyKey, out OutBase> = { readonly [_ in K]: OutBase };

type TypeFunction<K extends PropertyKey, InBase = any, OutBase = any> = TypeFunctionBase<InBase>
  & TypeFunctionOutput<K, OutBase>;

interface TypeAssertionTransform<A extends TypeAssertion<never> = TypeAssertion> extends TypeFunction<
  'assertion',
  A,
  TypeAssertion<never>
> {
  assertion: TypeAssertion<never>;
}

interface UnchangedTypeAssertion extends TypeAssertionTransform {
  assertion: Target<this>;
}

interface ForVariable extends TypeAssertionTransform {
  assertion: Variable<Target<this>>;
}

interface InvertAssertion extends TypeAssertionTransform<TypeAssertion<never>> {
  assertion: Not<Target<this>>;
}

interface ComposeTypeAssertionTransform<
  out A extends TypeAssertionTransform<B['assertion']>,
  out B extends TypeAssertionTransform<Base>,
  in Base extends TypeAssertion<never> = BaseTarget<B>,
> extends TypeAssertionTransform<Base> {
  assertion: TransformTypeAssertion<TransformTypeAssertion<Target<this>, B>, A>;
}

type TransformTypeAssertion<
  A extends TypeAssertion<never>,
  F extends TypeAssertionTransform<A>,
> = ApplyTypeFunction<F, 'assertion', A>;

interface CommonAssertions<T, F extends TypeAssertionTransform<TypeAssertion<T>> = UnchangedTypeAssertion> {
  Satisfies<A extends TypeAssertion<T>>(this: void): Satisfies<T, TransformTypeAssertion<A, F>>;
  Extends<Super>(this: void): Satisfies<T, TransformTypeAssertion<Extends<Super>, F>>;
  Not: CommonAssertions<T, ComposeTypeAssertionTransform<InvertAssertion, F, TypeAssertion<T>>>;
}
