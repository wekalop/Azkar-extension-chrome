(() => {
  if (window.__AZKAR_V1_LOADED__) {
    return;
  }
  window.__AZKAR_V1_LOADED__ = true;

  const PRAYER_ORDER = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];
  const PRAYER_NAME_AR = {
    Fajr: "الفجر",
    Dhuhr: "الظهر",
    Asr: "العصر",
    Maghrib: "المغرب",
    Isha: "العشاء"
  };

  const DEFAULT_SETTINGS = {
    azkarEnabled: true,
    azkarIntervalMinutes: 1,
    prayerSoundEnabled: true
  };
  const POPUP_AUTO_HIDE_MS = 15 * 1000;
  const AZKAR_MIN_ID = 52;
  const AZKAR_MAX_ID = 128;

  const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);

  class AzkarApp {
    constructor() {
      this.settings = { ...DEFAULT_SETTINGS };
      this.azkarItems = [];
      this.prayerCache = {};
      this.widgetElements = null;
      this.widget = null;
      this.azkarIntervalId = null;
      this.countdownIntervalId = null;
      this.prayerRefreshIntervalId = null;
      this.popupAutoHideTimeoutId = null;
      this.currentAzkarPopup = null;
      this.lastPrayerAlertKey = "";
      this.tomorrowPrefetchRunning = false;
      this.locationModal = null;
      this.storageListener = null;
      this.isShuttingDown = false;
    }

    async init() {
      await this.loadInitialState();
      await this.loadAzkarJson();
      this.createPrayerWidget();
      this.bindStorageListener();
      await this.ensureLocation();
      await this.refreshPrayerTimes(true);
      this.startPrayerTimers();
      this.applyAzkarSchedule();
      this.updateWidgetText();
    }

    async loadInitialState() {
      const stored = await chrome.storage.local.get([
        ...SETTINGS_KEYS,
        "prayerTimesCache",
        "lastPrayerAlertKey"
      ]);

      for (const key of SETTINGS_KEYS) {
        if (typeof stored[key] !== "undefined") {
          this.settings[key] = stored[key];
        }
      }

      this.prayerCache = stored.prayerTimesCache || {};
      this.lastPrayerAlertKey = stored.lastPrayerAlertKey || "";
    }

    async loadAzkarJson() {
      try {
        const response = await fetch(chrome.runtime.getURL("azkar.json"));
        const payload = await response.json();
        const list = Array.isArray(payload) ? payload : [];
        this.azkarItems = list
          .filter((item) => {
            const id = Number(item?.id);
            return Number.isInteger(id) && id >= AZKAR_MIN_ID && id <= AZKAR_MAX_ID;
          })
          .map((item) => ({
            ...item,
            text: this.normalizePopupText(item?.text),
            source: this.normalizePopupText(item?.source)
          }))
          .filter((item) => item.text.length > 0);
      } catch (error) {
        if (this.handleContextInvalidated(error)) {
          return;
        }
        console.error("Azkar file failed to load", error);
        this.azkarItems = [];
      }
    }

    normalizePopupText(input) {
      let text = String(input || "");
      text = text.replace(/\\[nrt]/g, " ");
      text = text.replace(/'\s*,\s*'/g, " ");
      text = text.replace(/\\/g, "");
      text = text.replace(/\s+/g, " ").trim();
      return text;
    }

    createPrayerWidget() {
      const widget = document.createElement("div");
      widget.className = "azkarv1-widget";
      widget.id = "azkarv1-widget";
      widget.setAttribute("dir", "rtl");
      widget.innerHTML = `
        <div class="azkarv1-widget-header">
          <span class="azkarv1-widget-title">الصلاة القادمة</span>
        </div>
        <div class="azkarv1-widget-row">
          <span class="azkarv1-label">الصلاة</span>
          <strong id="azkarv1-next-prayer">--</strong>
        </div>
        <div class="azkarv1-widget-row">
          <span class="azkarv1-label">العد التنازلي</span>
          <strong id="azkarv1-next-countdown">--:--:--</strong>
        </div>
      `;

      document.documentElement.appendChild(widget);
      this.widget = widget;
      this.widgetElements = {
        nextPrayer: widget.querySelector("#azkarv1-next-prayer"),
        countdown: widget.querySelector("#azkarv1-next-countdown")
      };

      this.makeDraggable(widget, {
        onDrop: async (position) => {
          try {
            await chrome.storage.local.set({ widgetPosition: position });
          } catch (error) {
            this.handleContextInvalidated(error);
          }
        }
      });

      this.applyWidgetPositionFromStorage();
    }

    async applyWidgetPositionFromStorage() {
      try {
        const stored = await chrome.storage.local.get(["widgetPosition"]);
        if (stored.widgetPosition?.top != null && stored.widgetPosition?.left != null) {
          this.widget.style.top = `${stored.widgetPosition.top}px`;
          this.widget.style.left = `${stored.widgetPosition.left}px`;
          this.widget.style.right = "auto";
        }
      } catch (error) {
        this.handleContextInvalidated(error);
      }
    }

    bindStorageListener() {
      this.storageListener = async (changes, area) => {
        if (area !== "local") {
          return;
        }

        try {
          let shouldRescheduleAzkar = false;
          let shouldRepaintWidget = false;

          for (const key of SETTINGS_KEYS) {
            if (changes[key]) {
              this.settings[key] = changes[key].newValue;
              shouldRescheduleAzkar = true;
            }
          }

          if (changes.widgetPosition?.newValue && this.widget) {
            const { top, left } = changes.widgetPosition.newValue;
            if (typeof top === "number" && typeof left === "number") {
              this.widget.style.top = `${top}px`;
              this.widget.style.left = `${left}px`;
              this.widget.style.right = "auto";
            }
          }

          if (changes.resetWidgetPositionToken && this.widget) {
            const defaultLeft = Math.max(8, window.innerWidth - this.widget.offsetWidth - 24);
            this.widget.style.top = "24px";
            this.widget.style.right = "24px";
            this.widget.style.left = "auto";
            await chrome.storage.local.set({ widgetPosition: { top: 24, left: defaultLeft } });
          }

          if (changes.prayerTimesCache) {
            this.prayerCache = changes.prayerTimesCache.newValue || {};
            shouldRepaintWidget = true;
          }

          if (changes.locationMode || changes.locationData) {
            shouldRepaintWidget = true;
            await this.refreshPrayerTimes(true);
          }

          if (changes.lastPrayerAlertKey) {
            this.lastPrayerAlertKey = changes.lastPrayerAlertKey.newValue || "";
          }

          if (shouldRescheduleAzkar) {
            this.applyAzkarSchedule();
          }

          if (shouldRepaintWidget) {
            this.updateWidgetText();
          }
        } catch (error) {
          if (!this.handleContextInvalidated(error)) {
            console.error("Storage listener error", error);
          }
        }
      };

      chrome.storage.onChanged.addListener(this.storageListener);
    }

    async ensureLocation() {
      try {
        // GPS is the primary source; if unavailable we force the manual city fallback UI.
        const stored = await chrome.storage.local.get([
          "locationMode",
          "locationData",
          "locationSetupDone"
        ]);

        if (stored.locationMode && stored.locationData) {
          this.updateLocationLabel(stored.locationMode, stored.locationData);
          return;
        }

        if (stored.locationSetupDone) {
          this.showCityFallbackModal();
          return;
        }

        try {
          const gps = await this.requestGeolocation();
          await chrome.storage.local.set({
            locationMode: "gps",
            locationData: gps,
            locationSetupDone: true
          });
          this.updateLocationLabel("gps", gps);
        } catch (_error) {
          await chrome.storage.local.set({ locationSetupDone: true });
          this.showCityFallbackModal();
        }
      } catch (error) {
        this.handleContextInvalidated(error);
      }
    }

    requestGeolocation() {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error("GEOLOCATION_NOT_SUPPORTED"));
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

    showCityFallbackModal() {
      if (this.locationModal) {
        return;
      }

      const wrapper = document.createElement("div");
      wrapper.className = "azkarv1-location-modal";
      wrapper.setAttribute("dir", "rtl");
      wrapper.innerHTML = `
        <div class="azkarv1-location-card">
          <h3>تحديد الموقع</h3>
          <p>تعذر الوصول إلى GPS. ادخل المدينة والدولة للمتابعة.</p>
          <label>المدينة
            <input id="azkarv1-city-input" type="text" placeholder="Cairo" />
          </label>
          <label>الدولة
            <input id="azkarv1-country-input" type="text" placeholder="Egypt" value="Egypt" />
          </label>
          <div class="azkarv1-location-actions">
            <button id="azkarv1-save-city" type="button">حفظ</button>
            <button id="azkarv1-retry-gps" type="button">اعادة محاولة GPS</button>
          </div>
          <small id="azkarv1-location-error"></small>
        </div>
      `;

      document.documentElement.appendChild(wrapper);
      this.locationModal = wrapper;

      const cityInput = wrapper.querySelector("#azkarv1-city-input");
      const countryInput = wrapper.querySelector("#azkarv1-country-input");
      const errorLabel = wrapper.querySelector("#azkarv1-location-error");

      wrapper.querySelector("#azkarv1-save-city").addEventListener("click", async () => {
        try {
          const city = cityInput.value.trim();
          const country = countryInput.value.trim();

          if (!city || !country) {
            errorLabel.textContent = "الرجاء ادخال المدينة والدولة.";
            return;
          }

          await chrome.storage.local.set({
            locationMode: "city",
            locationData: { city, country },
            locationSetupDone: true
          });

          this.updateLocationLabel("city", { city, country });
          this.removeLocationModal();
          await this.refreshPrayerTimes(true);
        } catch (error) {
          this.handleContextInvalidated(error);
        }
      });

      wrapper.querySelector("#azkarv1-retry-gps").addEventListener("click", async () => {
        errorLabel.textContent = "";
        try {
          const gps = await this.requestGeolocation();
          await chrome.storage.local.set({
            locationMode: "gps",
            locationData: gps,
            locationSetupDone: true
          });
          this.updateLocationLabel("gps", gps);
          this.removeLocationModal();
          await this.refreshPrayerTimes(true);
        } catch (error) {
          if (this.handleContextInvalidated(error)) {
            return;
          }
          errorLabel.textContent = "لم يتم السماح بالوصول إلى GPS.";
        }
      });
    }

    removeLocationModal() {
      if (!this.locationModal) {
        return;
      }
      this.locationModal.remove();
      this.locationModal = null;
    }

    updateLocationLabel(mode, payload) {
      void mode;
      void payload;
    }

    async refreshPrayerTimes(force = false) {
      if (this.isShuttingDown) {
        return;
      }

      const today = this.getDateKey(new Date());
      try {
        const response = await this.safeSendMessage({
          type: "GET_PRAYER_TIMES",
          dateKey: today,
          force
        });

        if (!response?.ok) {
          if (response?.error === "LOCATION_REQUIRED") {
            this.showCityFallbackModal();
          }
          return;
        }

        if (response.data?.dateKey) {
          this.prayerCache[response.data.dateKey] = response.data;
        }

        this.updateWidgetText();
      } catch (error) {
        if (this.handleContextInvalidated(error)) {
          return;
        }
        console.error("Prayer times refresh failed", error);
      }
    }

    startPrayerTimers() {
      this.stopPrayerTimers();

      this.countdownIntervalId = window.setInterval(() => {
        this.updateWidgetText();
      }, 1000);

      this.prayerRefreshIntervalId = window.setInterval(() => {
        this.refreshPrayerTimes(false);
      }, 60 * 1000);
    }

    stopPrayerTimers() {
      if (this.countdownIntervalId) {
        clearInterval(this.countdownIntervalId);
      }
      if (this.prayerRefreshIntervalId) {
        clearInterval(this.prayerRefreshIntervalId);
      }
      this.countdownIntervalId = null;
      this.prayerRefreshIntervalId = null;
    }

    updateWidgetText() {
      if (!this.widgetElements) {
        return;
      }

      const now = new Date();
      const todayKey = this.getDateKey(now);
      const todayData = this.prayerCache[todayKey];

      if (!todayData?.timings) {
        this.widgetElements.nextPrayer.textContent = "--";
        this.widgetElements.countdown.textContent = "--:--:--";
        return;
      }

      const nextPrayer = this.getNextPrayer(now, todayData);
      if (!nextPrayer) {
        this.widgetElements.nextPrayer.textContent = "--";
        this.widgetElements.countdown.textContent = "--:--:--";
        return;
      }

      const diff = nextPrayer.time.getTime() - now.getTime();
      this.widgetElements.nextPrayer.textContent = PRAYER_NAME_AR[nextPrayer.name] || nextPrayer.name;
      this.widgetElements.countdown.textContent = this.formatDuration(diff);

      this.handlePrayerWarning(nextPrayer, diff);
    }

    getNextPrayer(now, todayData) {
      const todayKey = todayData.dateKey;
      const dayStart = new Date(`${todayKey}T00:00:00`);

      for (const prayerName of PRAYER_ORDER) {
        const prayerTime = this.combineTime(dayStart, todayData.timings[prayerName]);
        if (prayerTime.getTime() > now.getTime()) {
          return {
            name: prayerName,
            time: prayerTime,
            dateKey: todayKey
          };
        }
      }

      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const tomorrowKey = this.getDateKey(tomorrow);
      const tomorrowData = this.prayerCache[tomorrowKey];
      if (!tomorrowData && !this.tomorrowPrefetchRunning) {
        // Needed for the "after Isha -> next prayer is tomorrow's Fajr" edge case.
        this.prefetchTomorrow(tomorrowKey);
      }

      const fajrTime = tomorrowData?.timings?.Fajr || todayData.timings.Fajr;
      return {
        name: "Fajr",
        time: this.combineTime(new Date(`${tomorrowKey}T00:00:00`), fajrTime),
        dateKey: tomorrowKey
      };
    }

    async prefetchTomorrow(tomorrowKey) {
      this.tomorrowPrefetchRunning = true;
      try {
        const response = await this.safeSendMessage({
          type: "GET_PRAYER_TIMES",
          dateKey: tomorrowKey,
          force: false
        });
        if (response?.ok && response.data?.dateKey) {
          this.prayerCache[response.data.dateKey] = response.data;
        }
      } catch (error) {
        if (this.handleContextInvalidated(error)) {
          return;
        }
        console.error("Prefetch tomorrow prayer times failed", error);
      } finally {
        this.tomorrowPrefetchRunning = false;
      }
    }

    async handlePrayerWarning(nextPrayer, diff) {
      if (!this.widget) {
        return;
      }

      const fifteenMinutes = 15 * 60 * 1000;
      if (diff > 0 && diff <= fifteenMinutes) {
        this.widget.classList.add("azkarv1-widget-warning");
        const prayerKey = `${nextPrayer.dateKey}-${nextPrayer.name}`;

        // One alert per prayer window, even across tabs/reloads via storage key.
        if (prayerKey !== this.lastPrayerAlertKey) {
          this.lastPrayerAlertKey = prayerKey;
          try {
            await chrome.storage.local.set({ lastPrayerAlertKey: prayerKey });
          } catch (error) {
            if (this.handleContextInvalidated(error)) {
              return;
            }
          }
          this.playReminderSound();
        }
      } else {
        this.widget.classList.remove("azkarv1-widget-warning");
      }
    }

    playReminderSound() {
      if (!this.settings.prayerSoundEnabled) {
        return;
      }

      const volume = 0.8;
      let audio;
      try {
        audio = new Audio(chrome.runtime.getURL("sounds/beep.mp3"));
      } catch (error) {
        if (this.handleContextInvalidated(error)) {
          return;
        }
        this.playOscillatorBeep(volume);
        return;
      }
      audio.volume = volume;

      audio.play().then(() => {
        window.setTimeout(() => {
          audio.pause();
          audio.currentTime = 0;
        }, 550);
      }).catch(() => {
        this.playOscillatorBeep(volume);
      });
    }

    playOscillatorBeep(volume) {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const context = new AudioCtx();
        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.frequency.value = 880;
        oscillator.type = "sine";
        gain.gain.value = volume;

        oscillator.connect(gain);
        gain.connect(context.destination);

        oscillator.start();
        oscillator.stop(context.currentTime + 0.5);
        oscillator.onended = () => context.close();
      } catch (error) {
        console.error("Oscillator beep failed", error);
      }
    }

    applyAzkarSchedule() {
      if (this.azkarIntervalId) {
        clearInterval(this.azkarIntervalId);
        this.azkarIntervalId = null;
      }

      if (!this.settings.azkarEnabled) {
        this.removeAzkarPopup();
        return;
      }

      // Interval is re-created every time settings change to prevent duplicate timers.
      const intervalMs = Math.max(1, Number(this.settings.azkarIntervalMinutes) || 1) * 60 * 1000;
      this.azkarIntervalId = window.setInterval(() => {
        this.showAzkarPopup();
      }, intervalMs);
    }

    showAzkarPopup() {
      if (this.currentAzkarPopup || this.azkarItems.length === 0) {
        return;
      }

      const item = this.getRandomAzkarItem();
      if (!item) {
        return;
      }
      const popup = document.createElement("div");
      popup.className = "azkarv1-popup";
      popup.setAttribute("dir", "rtl");
      popup.innerHTML = `
        <button class="azkarv1-popup-close" type="button" aria-label="close">×</button>
        <h4>ذكر</h4>
        <p class="azkarv1-popup-text">${this.escapeHtml(item.text || "")}</p>
        <small class="azkarv1-popup-source">${this.escapeHtml(item.source || "")}</small>
      `;

      document.documentElement.appendChild(popup);
      this.currentAzkarPopup = popup;

      this.makeDraggable(popup, { onDrop: () => {} });

      window.requestAnimationFrame(() => {
        popup.classList.add("azkarv1-popup-visible");
      });

      popup.querySelector(".azkarv1-popup-close").addEventListener("click", () => {
        this.removeAzkarPopup();
      });

      this.popupAutoHideTimeoutId = window.setTimeout(() => {
        this.removeAzkarPopup();
      }, POPUP_AUTO_HIDE_MS);
    }

    getRandomAzkarItem() {
      const allowed = this.azkarItems.filter((item) => {
        const id = Number(item?.id);
        return Number.isInteger(id) && id >= AZKAR_MIN_ID && id <= AZKAR_MAX_ID;
      });
      if (allowed.length === 0) {
        return null;
      }
      return allowed[Math.floor(Math.random() * allowed.length)];
    }

    removeAzkarPopup() {
      if (!this.currentAzkarPopup) {
        return;
      }

      if (this.popupAutoHideTimeoutId) {
        clearTimeout(this.popupAutoHideTimeoutId);
        this.popupAutoHideTimeoutId = null;
      }

      const popup = this.currentAzkarPopup;
      this.currentAzkarPopup = null;
      popup.classList.remove("azkarv1-popup-visible");
      window.setTimeout(() => popup.remove(), 300);
    }

    makeDraggable(element, { onDrop }) {
      let dragging = false;
      let offsetX = 0;
      let offsetY = 0;

      const down = (event) => {
        if (event.target.closest("button") || event.target.tagName === "INPUT") {
          return;
        }

        dragging = true;
        const rect = element.getBoundingClientRect();
        const point = this.pointerPoint(event);
        offsetX = point.x - rect.left;
        offsetY = point.y - rect.top;

        element.style.left = `${rect.left}px`;
        element.style.top = `${rect.top}px`;
        element.style.right = "auto";
        element.classList.add("azkarv1-dragging");
      };

      const move = (event) => {
        if (!dragging) {
          return;
        }
        const point = this.pointerPoint(event);
        const left = Math.max(8, Math.min(window.innerWidth - element.offsetWidth - 8, point.x - offsetX));
        const top = Math.max(8, Math.min(window.innerHeight - element.offsetHeight - 8, point.y - offsetY));

        element.style.left = `${left}px`;
        element.style.top = `${top}px`;
      };

      const up = () => {
        if (!dragging) {
          return;
        }
        dragging = false;
        element.classList.remove("azkarv1-dragging");

        const rect = element.getBoundingClientRect();
        Promise.resolve(onDrop({ top: Math.round(rect.top), left: Math.round(rect.left) }))
          .catch((error) => {
            this.handleContextInvalidated(error);
          });
      };

      element.addEventListener("mousedown", down);
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);

      element.addEventListener("touchstart", down, { passive: true });
      document.addEventListener("touchmove", move, { passive: true });
      document.addEventListener("touchend", up);
    }

    pointerPoint(event) {
      if (event.touches?.length) {
        return {
          x: event.touches[0].clientX,
          y: event.touches[0].clientY
        };
      }

      return {
        x: event.clientX,
        y: event.clientY
      };
    }

    combineTime(day, hhmm) {
      const [hoursRaw, minutesRaw] = String(hhmm || "00:00").split(":");
      const hours = Number(hoursRaw) || 0;
      const minutes = Number(minutesRaw) || 0;
      return new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        hours,
        minutes,
        0,
        0
      );
    }

    formatDuration(ms) {
      const safeMs = Math.max(ms, 0);
      const totalSeconds = Math.floor(safeMs / 1000);
      const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
      const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
      const seconds = String(totalSeconds % 60).padStart(2, "0");
      return `${hours}:${minutes}:${seconds}`;
    }

    getDateKey(date) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }

    safeSendMessage(message) {
      if (!this.isRuntimeAvailable()) {
        throw new Error("Extension context invalidated.");
      }
      return chrome.runtime.sendMessage(message);
    }

    isRuntimeAvailable() {
      try {
        return Boolean(chrome?.runtime?.id);
      } catch (_error) {
        return false;
      }
    }

    isContextInvalidatedError(error) {
      const message = String(error?.message || error || "");
      return message.toLowerCase().includes("extension context invalidated");
    }

    handleContextInvalidated(error) {
      if (!this.isContextInvalidatedError(error) && this.isRuntimeAvailable()) {
        return false;
      }
      this.shutdown();
      return true;
    }

    shutdown() {
      if (this.isShuttingDown) {
        return;
      }
      this.isShuttingDown = true;

      this.stopPrayerTimers();
      if (this.azkarIntervalId) {
        clearInterval(this.azkarIntervalId);
        this.azkarIntervalId = null;
      }

      if (this.popupAutoHideTimeoutId) {
        clearTimeout(this.popupAutoHideTimeoutId);
        this.popupAutoHideTimeoutId = null;
      }

      if (this.storageListener && chrome?.storage?.onChanged?.hasListener?.(this.storageListener)) {
        chrome.storage.onChanged.removeListener(this.storageListener);
      }
      this.storageListener = null;

      this.removeAzkarPopup();
      this.removeLocationModal();
    }

    clamp(value, min, max) {
      return Math.max(min, Math.min(max, Number(value)));
    }

    escapeHtml(input) {
      return String(input)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }
  }

  const app = new AzkarApp();
  app.init().catch((error) => {
    if (!app.handleContextInvalidated(error)) {
      console.error("AzkarV1 initialization failed", error);
    }
  });
})();
