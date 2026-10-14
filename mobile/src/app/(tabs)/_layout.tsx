import { Tabs } from "expo-router";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerTitleAlign: "left",
        tabBarActiveTintColor: "#00853e",
      }}
    >
      <Tabs.Screen name="courses" options={{ title: "Courses" }} />
      <Tabs.Screen name="week" options={{ title: "Week" }} />
      <Tabs.Screen name="day" options={{ title: "Day" }} />
    </Tabs>
  );
}
