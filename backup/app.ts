import packageInfo from "../package.json";
const LOGO = String.raw`
  ▄▄▄▄     ▄▄     ▄▄▄   ▄▄▄▄     ▄▄▄▄   ▄▄▄  ▄▄ ▄▄  ▄▄ ▄▄ 
 ██▀▀▀ ▄▄▄ ██    ██▀██ ██ ▄▄ ▄▄▄ ██▀██ ██▀██ ██ ██  ▀███▀ 
 ▀████     ██▄▄▄ ▀███▀ ▀███▀     ████▀ ██▀██ ██ ██▄▄▄ █
`;

const DEFAULT_CONFIG = {
  version: packageInfo.version,
  projects: [],
  model: {
      baseUrl: "https://api.openai.com",
      model: "gpt-4.1-mini",
      apiKey: ""
  },
  report: {
    outputDir: "",
    outputMode: "stdout",
  }
};