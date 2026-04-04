type _Validity<V> = V | readonly _Validity<V>[] | { [key: string]: _Validity<V> } | (() => _Validity<V>);

export type Valid = _Validity<void>;
export type Validity = _Validity<void | _Invalid<any>>;
export type IfValid<V extends Validity, T> = [V] extends [Valid] ? T : V;
export type IfSatisfies<X, A extends MinTypeAssertion<X>, T> = IfValid<Satisfies<X, A>, T>;

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
  Satisfies<T, A extends MinTypeAssertion<T>>(this: void): Satisfies<T, A>;
  <const T>(this: void, value: T): CommonAssertions<T>;
  Variable<const V extends { [k: string]: any }>(this: void, value: V): CommonAssertions<V, ForVariable>;
}

interface TypeAssertWithKnownTypeFunction<
  T,
  F extends TypeAssertionTransform<MinTypeAssertion<T>> = UnchangedTypeAssertion,
> {
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

TypeAssert.Function = <A extends MinTypeAssertion<Base>, Base = BaseTarget<A>>() => ({
  calls: <Args extends readonly unknown[] = [], Ret = void>(
    body: <T extends Base>(value: ImpliedIfValid<T, A>, ...args: Args) => Ret,
  ) => body as <T extends Base>(value: IfSatisfies<T, A, ImpliedIfInvalid<T, A>>, ...args: Args) => Ret,
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
type TargetSatisfies<A1 extends MinTypeAssertion, A2 extends MinTypeAssertion> = _Satisfies<
  Target<A1>,
  A2,
  Name<A1>
>;

export interface All<A extends readonly MinTypeAssertion[]> extends TypeAssertion<BaseTarget<A[number]>> {
  assert: { [K in keyof A]: TargetSatisfies<this, A[K]> };
}

export interface Extends<Super> extends TypeAssertion<any> {
  assert: Target<this> extends Super ? void : Invalid<['expected', Name<this>, 'to extend', Super]>;
  invert: NotExtends<Super>;

  implications: _Implications & { decides: [Super] };
}

export interface NotExtends<Super> extends TypeAssertion<any> {
  assert: Target<this> extends Super ? Invalid<['expected', Name<this>, 'not to extend', Super]> : void;
  invert: Extends<Super>;

  implications: _Implications & { decidesNot: [Super] };
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
// type AssumeSubtype<Super, Sub> = _Subtype<Super, Extract<Sub, Super>>;
type EnforceSubtype<Super, Sub extends Super> = AssumeSubtype<Super, Sub>;

declare const _baseTargetHelper: unique symbol;

interface _BaseTargetHelper {
  [_baseTargetHelper]: this extends TypeFunctionBase<infer B> ? B : never;
}

type BaseTarget<A extends TypeFunctionBase<never>> = (A & _BaseTargetHelper)[typeof _baseTargetHelper];

type Target<A extends TypeFunctionBase<Base>, Base = BaseTarget<A>> = (A
  & _TargetHelper<Base>)[typeof _targetHelper];

declare const _targetHelper: unique symbol;

interface _TargetHelper<Base> {
  [_target]?: unknown;
  [_targetHelper]: typeof _target extends keyof this ? Extract<this[typeof _target], Base> : Base;
}

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

type Name<A extends MinTypeAssertion<Base>, Base = BaseTarget<A>> =
  A extends _Named<infer S> ? S : Target<A, Base>;

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

interface _Implications {
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

interface Implications<in Base = never> extends TypeFunctionBase<Base>, _Implications {}

type Implication<
  This extends TypeFunctionBase<never>,
  T extends MinTypeAssertion,
  K extends keyof _Implications,
> = AssumeSubtype<readonly unknown[], (T & { [_target]: Target<This> })[K & keyof T]>;

interface ImpliesType<in T extends readonly unknown[]> {}

export interface TypeAssertion<in Base = never>
  extends TypeFunction<'assert', Base, Validity>, Implications<Base> {
  readonly [_target]: unknown;
  readonly assert: Validity | Invalid<['missing assertion']>;
}

interface For<T, Name = T> {
  readonly [_target]: T;
  readonly [_targetName]: Name;
}

interface MinTypeAssertion<in B = never> extends TypeFunctionBase<B> {
  readonly assert: Validity;
}

type MinTypeAssertions<B = never> =
  | MinTypeAssertion<B>
  | readonly MinTypeAssertions<B>[]
  | { [k: string]: MinTypeAssertions<B> };

type _SatisfiesAssertion<T, A extends MinTypeAssertion, Name = T> = EnforceSubtype<
  Validity,
  (For<T, Name> & A)['assert']
>;

type _SatisfiesInternal<T, A, Name = T> = AssumeSubtype<
  Validity,
  A extends MinTypeAssertion ? EnforceSubtype<Validity, _SatisfiesAssertion<T, A, Name>>
  : A extends readonly unknown[] ? never
  : // AssumeSubtype<readonly Validity[], { [K in keyof A]: _SatisfiesInternal<T, A[K], Name> }>
    never
  // : AssumeSubtype<Validity, { [K in keyof A]: _SatisfiesInternal<T, A[K], Name> }>
>;

type _Satisfies<T, A extends MinTypeAssertions, Name = T> = AssumeSubtype<
  Validity,
  _SatisfiesInternal<T, A, Name>
>;

type Satisfies<T, A extends MinTypeAssertions> = _Satisfies<T, A>;

type VariableSatisfies<
  V extends { [k: string]: any },
  A extends MinTypeAssertions<PropsOf<V>>,
> = EnforceSubtype<
  Validity,
  PropsOf<{ [K in keyof V]: _Satisfies<V[K], A, K extends string ? _Name<`typeof ${K}`> : V[K]> }>
>;

interface MissingInverted extends MinTypeAssertion {
  assert: Invalid<['missing inverted assertion']>;
}

interface TypeAssertionWithInversion extends MinTypeAssertion {
  invert: MinTypeAssertion | MissingInverted;
}

export interface _Not<
  A extends MinTypeAssertion<Base>,
  Base extends BaseTarget<A> = BaseTarget<A>,
> extends TypeAssertion<Base> {
  assert: Satisfies<Target<this>, A> extends Valid ? Invalid<['expected', Name<this>, 'to fail', A]>
  : Valid;
  invert: A;
  implies: Implication<this, A, 'allowsNot'>;
  allows: Implication<this, A, 'impliesNot'>;
  decides: Implication<this, A, 'decidesNot'>;
  impliesNot: Implication<this, A, 'allows'>;
  allowsNot: Implication<this, A, 'implies'>;
  decidesNot: Implication<this, A, 'decides'>;
}

export type Not<A extends MinTypeAssertion<never>> =
  A extends TypeAssertionWithInversion ? A['invert'] : _Not<A>;

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

type ImpliedIfValid<
  T,
  A extends MinTypeAssertion<Base>,
  Base = BaseTarget<A>,
  _A extends Implications<Base> = Extract<A, _Implications> & { [_target]: T },
> = Exclude<
  SoftIntersect<T, SoftIntersectItems<_A['implies'] | _A['decides']>>,
  _A['impliesNot'][number] | _A['decidesNot'][number]
>;

type ImpliedIfInvalid<
  T,
  A extends MinTypeAssertion<Base>,
  Base = BaseTarget<A>,
  _A extends Implications<Base> = Extract<A, _Implications> & { [_target]: T },
> = Exclude<
  SoftIntersect<T, SoftIntersectItems<_A['allowsNot'] | _A['decidesNot']>>,
  _A['allows'][number] | _A['decides'][number]
>;

interface VariableObj<T = any> {
  readonly [k: string]: T;
}

type ImpliesForVariable<
  This extends TypeFunctionBase<VariableObj<any>>,
  A extends MinTypeAssertion,
  Field extends keyof _Implications,
  Base extends readonly unknown[] = (Extract<A, _Implications> & {
    [_target]: PropsOf<Target<This>>;
  })[Field],
> = { [Idx in keyof Base]: { [K in keyof Target<This>]: Base[Idx] } };

interface Variable<A extends MinTypeAssertion<Base>, Base = BaseTarget<A>> extends TypeAssertion<
  VariableObj<Base>
> {
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
  // readonly [_target]: unknown;
  readonly [_targetBase]: Contravariant<InBase>;
}

type TypeFunctionOutput<K extends PropertyKey, out OutBase> = { readonly [_ in K]: OutBase };

type TypeFunction<K extends PropertyKey, InBase = any, OutBase = any> = TypeFunctionBase<InBase>
  & TypeFunctionOutput<K, OutBase>;

interface TypeAssertionTransform<
  in A extends MinTypeAssertion<never> = MinTypeAssertion<any>,
> extends TypeFunction<'assertion', A, MinTypeAssertion<never>> {
  assertion: MinTypeAssertion<never>;
}

interface UnchangedTypeAssertion extends TypeAssertionTransform<MinTypeAssertion<never>> {
  assertion: Target<this>;
}

interface ForVariable extends TypeAssertionTransform<MinTypeAssertion<never>> {
  assertion: Variable<Target<this>>;
}

interface InvertAssertion extends TypeAssertionTransform<MinTypeAssertion<never>> {
  assertion: Not<Target<this>>;
}

interface ComposeTypeAssertionTransform<
  out A extends TypeAssertionTransform<B['assertion']>,
  out B extends TypeAssertionTransform<Base>,
  in Base extends MinTypeAssertion<never> = BaseTarget<B>,
> extends TypeAssertionTransform<Base> {
  assertion: TransformTypeAssertion<TransformTypeAssertion<Target<this>, B>, A>;
}

type TransformTypeAssertion<
  A extends MinTypeAssertion<never>,
  F extends TypeAssertionTransform<A>,
> = ApplyTypeFunction<F, 'assertion', A>;

interface CommonAssertions<
  T,
  F extends TypeAssertionTransform<MinTypeAssertion<T>> = UnchangedTypeAssertion,
> {
  Satisfies<A extends MinTypeAssertion<T>>(this: void): Satisfies<T, TransformTypeAssertion<A, F>>;
  Extends<Super>(this: void): Satisfies<T, TransformTypeAssertion<Extends<Super>, F>>;
  Not: CommonAssertions<T, ComposeTypeAssertionTransform<InvertAssertion, F, MinTypeAssertion<T>>>;
}
