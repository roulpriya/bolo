import { createRoot } from "react-dom/client";
import { installBrowserShimIfNeeded } from "../browser-shim";
import { SettingsPage } from "./components/settings-page";

installBrowserShimIfNeeded();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Bolo settings renderer root element was not found.");
}
createRoot(rootElement).render(<SettingsPage />);
