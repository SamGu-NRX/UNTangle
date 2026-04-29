async (page) => {
  const capture = async (url, path, viewport) => {
    await page.setViewportSize(viewport);
    await page.goto(url, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    await page.screenshot({ path, fullPage: true });
  };

  await capture("http://127.0.0.1:3012/courses/PSCI/2306", "course-detail-desktop.png", {
    width: 1440,
    height: 1000,
  });
  await capture("http://127.0.0.1:3012/instructors/3437", "instructor-detail-desktop.png", {
    width: 1440,
    height: 1000,
  });
  await capture("http://127.0.0.1:3012/courses/PSCI/2306", "course-detail-mobile.png", {
    width: 390,
    height: 844,
  });
  await capture("http://127.0.0.1:3012/instructors/3437", "instructor-detail-mobile.png", {
    width: 390,
    height: 844,
  });
}
