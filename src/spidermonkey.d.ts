// SpiderMonkey source extensions (obsolete in Firefox, still present in
// ExtendScript's engine). Availability is probed at runtime; these
// declarations only let the typechecker see them.
declare function uneval(value: any): string;

interface Object {
  toSource(): string;
}
interface Array<T> {
  toSource(): string;
}
interface String {
  toSource(): string;
  quote(): string;
}
