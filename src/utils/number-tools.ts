export class NumberTools {
  static format(value: number | null | undefined, digits = 1): string {
    if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
    return Number(value).toFixed(digits);
  }
}
