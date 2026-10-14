import { Redirect } from "expo-router";

/** The app opens on the course catalog. */
export default function Index() {
  return <Redirect href="/(tabs)/courses" />;
}
