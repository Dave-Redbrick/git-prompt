import { useEffect, useState } from "react";

const usdKrwRateStorageKey = "git-prompt-usd-krw-exchange-rate";
const usdKrwFallbackRate = 1400;
const usdKrwRateUrl = "https://api.frankfurter.dev/v2/rates?base=USD&quotes=KRW";

export type UsdKrwExchangeRate = {
  base: "USD";
  quote: "KRW";
  rate: number;
  date: string;
  fetchedAt: string;
  fetchedFor: string;
  fallback?: boolean;
};

const getLocalDateKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const isUsdKrwExchangeRate = (value: unknown): value is UsdKrwExchangeRate => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const rate = value as Partial<UsdKrwExchangeRate>;

  return (
    rate.base === "USD" &&
    rate.quote === "KRW" &&
    typeof rate.rate === "number" &&
    Number.isFinite(rate.rate) &&
    rate.rate > 0 &&
    typeof rate.date === "string" &&
    typeof rate.fetchedAt === "string" &&
    typeof rate.fetchedFor === "string" &&
    (rate.fallback === undefined || typeof rate.fallback === "boolean")
  );
};

export const readUsdKrwExchangeRate = () => {
  try {
    const raw = localStorage.getItem(usdKrwRateStorageKey);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;

    return isUsdKrwExchangeRate(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const writeUsdKrwExchangeRate = (exchangeRate: UsdKrwExchangeRate) => {
  try {
    localStorage.setItem(usdKrwRateStorageKey, JSON.stringify(exchangeRate));
  } catch {
    // Exchange-rate caching is an optimization. The UI can still use state.
  }
};

const isFreshForToday = (exchangeRate: UsdKrwExchangeRate | null) =>
  exchangeRate?.fetchedFor === getLocalDateKey();

const createFallbackExchangeRate = (): UsdKrwExchangeRate => ({
  base: "USD",
  quote: "KRW",
  rate: usdKrwFallbackRate,
  date: "fallback",
  fetchedAt: new Date().toISOString(),
  fetchedFor: getLocalDateKey(),
  fallback: true,
});

export const useUsdKrwExchangeRate = (enabled: boolean) => {
  const [exchangeRate, setExchangeRate] = useState<UsdKrwExchangeRate | null>(
    readUsdKrwExchangeRate,
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const cachedExchangeRate = readUsdKrwExchangeRate();
    const fallbackExchangeRate = createFallbackExchangeRate();

    setExchangeRate(cachedExchangeRate ?? fallbackExchangeRate);

    if (isFreshForToday(cachedExchangeRate)) {
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    fetch(usdKrwRateUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Exchange rate request failed: ${response.status}`);
        }

        return response.json() as Promise<{ date?: string; rates?: { KRW?: number } }>;
      })
      .then((data) => {
        const rate = Number(data.rates?.KRW);

        if (!Number.isFinite(rate) || rate <= 0) {
          throw new Error("Invalid USD/KRW exchange rate");
        }

        const nextExchangeRate: UsdKrwExchangeRate = {
          base: "USD",
          quote: "KRW",
          rate,
          date: data.date ?? "",
          fetchedAt: new Date().toISOString(),
          fetchedFor: getLocalDateKey(),
        };

        writeUsdKrwExchangeRate(nextExchangeRate);

        if (!cancelled) {
          setExchangeRate(nextExchangeRate);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExchangeRate(cachedExchangeRate ?? fallbackExchangeRate);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled]);

  return exchangeRate;
};
