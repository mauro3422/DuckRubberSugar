/**
 * Shared code analysis utilities.
 * Extracted to eliminate duplication between JsonTools and BenchmarkService.
 */
export class CodeAnalysis {
  static hasUnbalancedDelimiters(value: string): boolean {
    const opens = (value.match(/\(/g) ?? []).length;
    const closes = (value.match(/\)/g) ?? []).length;
    const openBraces = (value.match(/\{/g) ?? []).length;
    const closeBraces = (value.match(/\}/g) ?? []).length;
    const openBrackets = (value.match(/\[/g) ?? []).length;
    const closeBrackets = (value.match(/\]/g) ?? []).length;
    const doubleQuotes = (value.match(/(?<!\\)"/g) ?? []).length;
    const singleQuotes = (value.match(/(?<!\\)'/g) ?? []).length;
    return (
      opens !== closes ||
      openBraces !== closeBraces ||
      openBrackets !== closeBrackets ||
      doubleQuotes % 2 !== 0 ||
      singleQuotes % 2 !== 0
    );
  }
}
