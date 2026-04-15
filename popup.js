const DEFAULT_SETTINGS = {
  azkarEnabled: true,
  azkarIntervalMinutes: 1,
  prayerSoundEnabled: true
};

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);

const controls = {
  azkarEnabled: document.getElementById("azkarEnabled"),
  azkarIntervalMinutes: document.getElementById("azkarIntervalMinutes"),
  prayerSoundEnabled: document.getElementById("prayerSoundEnabled"),
  resetWidgetPosition: document.getElementById("resetWidgetPosition"),
  requestGps: document.getElementById("requestGps"),
  manualCity: document.getElementById("manualCity"),
  manualCountry: document.getElementById("manualCountry"),
  saveManualLocation: document.getElementById("saveManualLocation"),
  statusMessage: document.getElementById("statusMessage"),
  locationInfo: document.getElementById("locationInfo")
};

init().catch((error) => {
  setStatus(`Initialization error: ${error.message}`, true);
});

async function init() {
  const stored = await chrome.storage.local.get([
    ...SETTINGS_KEYS,
    "locationMode",
    "locationData"
  ]);

  populateSettings(stored);
  bindSettingsHandlers();
  bindActionHandlers();
  renderLocationInfo(stored.locationMode, stored.locationData);
}

function populateSettings(stored) {
  controls.azkarEnabled.checked = stored.azkarEnabled ?? DEFAULT_SETTINGS.azkarEnabled;
  controls.azkarIntervalMinutes.value = stored.azkarIntervalMinutes ?? DEFAULT_SETTINGS.azkarIntervalMinutes;
  controls.prayerSoundEnabled.checked = stored.prayerSoundEnabled ?? DEFAULT_SETTINGS.prayerSoundEnabled;

  if (stored.locationMode === "city") {
    controls.manualCity.value = stored.locationData?.city || "";
    controls.manualCountry.value = stored.locationData?.country || "";
  }
}

function bindSettingsHandlers() {
  controls.azkarEnabled.addEventListener("change", () => persistSetting("azkarEnabled", controls.azkarEnabled.checked));
  controls.prayerSoundEnabled.addEventListener("change", () => persistSetting("prayerSoundEnabled", controls.prayerSoundEnabled.checked));

  controls.azkarIntervalMinutes.addEventListener("change", () => {
    const value = clampNumber(controls.azkarIntervalMinutes.value, 1, 60, 1);
    controls.azkarIntervalMinutes.value = value;
    persistSetting("azkarIntervalMinutes", value);
  });
}

function bindActionHandlers() {
  controls.resetWidgetPosition.addEventListener("click", async () => {
    await chrome.storage.local.set({
      resetWidgetPositionToken: Date.now()
    });
    setStatus("تم اعادة ضبط مكان الودجت.", false);
  });

  controls.requestGps.addEventListener("click", async () => {
    setStatus("جاري طلب GPS...", false);

    try {
      const gps = await requestGps();
      await chrome.storage.local.set({
        locationMode: "gps",
        locationData: gps,
        locationSetupDone: true
      });

      await chrome.runtime.sendMessage({ type: "FORCE_REFRESH_PRAYER_TIMES" });
      renderLocationInfo("gps", gps);
      setStatus("تم تحديث الموقع عبر GPS.", false);
    } catch (_error) {
      setStatus("تعذر الوصول إلى GPS. استخدم الادخال اليدوي.", true);
    }
  });

  controls.saveManualLocation.addEventListener("click", async () => {
    const city = controls.manualCity.value.trim();
    const country = controls.manualCountry.value.trim();

    if (!city || !country) {
      setStatus("ادخل المدينة والدولة قبل الحفظ.", true);
      return;
    }

    await chrome.storage.local.set({
      locationMode: "city",
      locationData: { city, country },
      locationSetupDone: true
    });

    await chrome.runtime.sendMessage({ type: "FORCE_REFRESH_PRAYER_TIMES" });
    renderLocationInfo("city", { city, country });
    setStatus("تم حفظ الموقع اليدوي وتحديث مواقيت الصلاة.", false);
  });
}

async function persistSetting(key, value) {
  await chrome.storage.local.set({ [key]: value });
  setStatus("تم حفظ الاعدادات.", false);
}

function requestGps() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("NO_GEOLOCATION"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: Number(position.coords.latitude.toFixed(6)),
          longitude: Number(position.coords.longitude.toFixed(6))
        });
      },
      (error) => reject(error),
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000
      }
    );
  });
}

function renderLocationInfo(mode, data) {
  if (!mode || !data) {
    controls.locationInfo.textContent = "الموقع الحالي: غير محدد";
    return;
  }

  if (mode === "gps") {
    controls.locationInfo.textContent = `الموقع الحالي: GPS (${data.latitude}, ${data.longitude})`;
  } else {
    controls.locationInfo.textContent = `الموقع الحالي: ${data.city}, ${data.country}`;
  }
}

function setStatus(message, isError) {
  controls.statusMessage.textContent = message;
  controls.statusMessage.style.color = isError ? "#b42318" : "#166534";
}

function clampNumber(rawValue, min, max, fallback) {
  const parsed = Number(rawValue);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}
