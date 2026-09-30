
import { extensionNetworkUrl, shouldRoute, route } from "./RivetRouter";

Object.assign(globalThis, {
  $rivetRouter: { extensionNetworkUrl, shouldRoute, route },
});
