# AI Homework Helper

This project is a small web app that accepts text or an image, calls the Gemini
Flash API on the server, and returns an answer to the browser. API keys and
model settings are stored locally in the browser and sent only with requests.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Start the server:

```bash
npm run dev
```

3. Open the app:

```
http://localhost:3000
```

## Usage

- Open `http://localhost:3000/settings.html` and add one or more API keys.
- Set the model (default: `gemini-3-flash-preview`).
- The app will round-robin between keys and track daily request/token usage.
- Use `http://localhost:3000` to upload an image, type a question, or do both.
- Click "Solve now" to get the answer, then copy it with the button.

## Notes

- API version is fixed to `v1beta`.
- Default model: `gemini-3-flash-preview` (change it in Settings if needed).
- Max image size: 10MB.
- Theme can be switched in Settings (system/light/dark).
