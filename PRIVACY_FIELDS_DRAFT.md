# AzkarV1 Privacy Fields - Draft Answers

## Single purpose
AzkarV1 provides Islamic Azkar reminders and a next-prayer countdown widget while browsing.

## Permissions Justification
- storage: Save user settings, widget position, location mode, and cached prayer times.
- alarms: Trigger periodic background refresh checks for prayer times cache.
- geolocation: Detect user coordinates for accurate local prayer times (with user permission).

## Host permissions justification
- https://api.aladhan.com/* : Fetch daily prayer times from Aladhan API.

## Remote code declaration
No. The extension does not execute remotely hosted code.

## Data usage disclosure (adapt exactly to real behavior)
- Collected from user (locally):
  - Extension settings (popup enabled, interval, sound toggle)
  - Location choice (GPS coordinates or manual city/country)
- Sent to third-party service:
  - Coordinates OR city/country to Aladhan API to retrieve prayer times
- Stored locally:
  - Prayer times cache and user settings in `chrome.storage.local`
- Not collected:
  - Account credentials
  - Payment info
  - Personal communications
  - Browser history export

## Privacy policy URL requirement
Provide a public URL that clearly states:
- What data is used
- Why it is used
- Where it is stored
- Whether shared with third parties
- Contact method for support/deletion requests
