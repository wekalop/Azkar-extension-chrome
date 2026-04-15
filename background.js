const PRAYER_KEYS = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];
const DEFAULT_SETTINGS = {
  azkarEnabled: true,
  azkarIntervalMinutes: 1,
  prayerSoundEnabled: true
};

const DAILY_ALARM_NAME = "azkarv1-daily-prayer-sync";
const activeFetchByDate = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  await initializeDefaults();
  await ensureAlarm();
  try {
    await ensurePrayerTimesForDate(getDateKey(new Date()));
  } catch (_error) {
    // Location may not be set yet on first install.
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== DAILY_ALARM_NAME) {
    return;
  }
  try {
    await ensurePrayerTimesForDate(getDateKey(new Date()));
  } catch (_error) {
    // Skip silently until location is configured.
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((payload) => sendResponse({ ok: true, ...payload }))
    .catch((error) => {
      sendResponse({ ok: false, error: error.message || "UNKNOWN_ERROR" });
    });
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "GET_PRAYER_TIMES": {
      const dateKey = message.dateKey || getDateKey(new Date());
      const data = await ensurePrayerTimesForDate(dateKey, Boolean(message.force));
      return { data };
    }
    case "FORCE_REFRESH_PRAYER_TIMES": {
      const today = getDateKey(new Date());
      const data = await ensurePrayerTimesForDate(today, true);
      return { data };
    }
    case "SAVE_LOCATION": {
      const { mode, payload } = message;
      if (!mode || !payload) {
        throw new Error("INVALID_LOCATION_PAYLOAD");
      }
      await chrome.storage.local.set({
        locationMode: mode,
        locationData: payload,
        locationSetupDone: true
      });
      const today = getDateKey(new Date());
      const data = await ensurePrayerTimesForDate(today, true);
      return { data };
    }
    case "GET_DEFAULT_SETTINGS": {
      return { defaults: DEFAULT_SETTINGS };
    }
    default:
      throw new Error("UNSUPPORTED_MESSAGE_TYPE");
  }
}

async function initializeDefaults() {
  const keys = [
    ...Object.keys(DEFAULT_SETTINGS),
    "prayerTimesCache",
    "locationMode",
    "locationData",
    "locationSetupDone"
  ];

  const stored = await chrome.storage.local.get(keys);
  const updates = {};

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (typeof stored[key] === "undefined") {
      updates[key] = value;
    }
  }

  if (!stored.prayerTimesCache) {
    updates.prayerTimesCache = {};
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
}

async function ensureAlarm() {
  const existing = await chrome.alarms.get(DAILY_ALARM_NAME);
  if (existing) {
    return;
  }

  chrome.alarms.create(DAILY_ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: 60
  });
}

async function ensurePrayerTimesForDate(dateKey, force = false) {
  const storage = await chrome.storage.local.get([
    "prayerTimesCache",
    "locationMode",
    "locationData"
  ]);

  const cache = storage.prayerTimesCache || {};
  // Fetch at most once per date unless explicitly forced.
  if (!force && cache[dateKey]?.timings) {
    return cache[dateKey];
  }

  if (!storage.locationMode || !storage.locationData) {
    throw new Error("LOCATION_REQUIRED");
  }

  if (activeFetchByDate.has(dateKey)) {
    return activeFetchByDate.get(dateKey);
  }

  const fetchPromise = fetchPrayerTimes(dateKey, {
    mode: storage.locationMode,
    data: storage.locationData
  }).then(async (result) => {
    const refreshed = await chrome.storage.local.get(["prayerTimesCache"]);
    const refreshedCache = refreshed.prayerTimesCache || {};
    refreshedCache[dateKey] = result;
    await chrome.storage.local.set({ prayerTimesCache: refreshedCache });
    return result;
  }).finally(() => {
    activeFetchByDate.delete(dateKey);
  });

  activeFetchByDate.set(dateKey, fetchPromise);
  return fetchPromise;
}

async function fetchPrayerTimes(dateKey, location) {
  const dateParam = toApiDate(dateKey);
  let url;
  let source;

  if (location.mode === "gps") {
    const { latitude, longitude } = location.data;
    if (typeof latitude !== "number" || typeof longitude !== "number") {
      throw new Error("INVALID_GPS_COORDINATES");
    }

    url = `https://api.aladhan.com/v1/timings/${dateParam}?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&method=3`;
    source = "gps";
  } else {
    const { city, country } = location.data;
    if (!city || !country) {
      throw new Error("INVALID_CITY_LOCATION");
    }

    url = `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=3&date=${encodeURIComponent(dateParam)}`;
    source = "city";
  }

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`API_REQUEST_FAILED_${response.status}`);
  }

  const body = await response.json();
  if (body.code !== 200 || !body?.data?.timings) {
    throw new Error("API_INVALID_RESPONSE");
  }

  const cleanedTimings = {};
  for (const prayerKey of PRAYER_KEYS) {
    cleanedTimings[prayerKey] = cleanTime(body.data.timings[prayerKey]);
  }

  return {
    dateKey,
    timings: cleanedTimings,
    fetchedAt: Date.now(),
    source,
    timezone: body?.data?.meta?.timezone || ""
  };
}

function cleanTime(value) {
  if (!value) {
    return "00:00";
  }
  return String(value).split(" ")[0];
}

function getDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toApiDate(dateKey) {
  const [year, month, day] = dateKey.split("-");
  return `${day}-${month}-${year}`;
}

