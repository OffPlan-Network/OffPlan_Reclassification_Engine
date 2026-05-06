export const fmtUSD = (n, decimals = 0) => {
  if (n === null || n === undefined || isNaN(n)) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
};

export const fmtNum = (n) => {
  if (n === null || n === undefined || isNaN(n)) return "0";
  return new Intl.NumberFormat("en-US").format(Math.round(n));
};

export const fmtPct = (n, decimals = 1) => {
  if (n === null || n === undefined || isNaN(n)) return "0%";
  return `${(n * 100).toFixed(decimals)}%`;
};
