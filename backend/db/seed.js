import db from './database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

db.exec(`DELETE FROM sections; DELETE FROM courses;`);

const insertCourse = db.prepare(`
  INSERT OR IGNORE INTO courses (subject, number, title, credits)
  VALUES (@subject, @number, @title, @credits)
`);

const getCourse = db.prepare(
  `SELECT id FROM courses WHERE subject = ? AND number = ?`
);

const insertSection = db.prepare(`
  INSERT INTO sections
    (course_id, section_code, instructor, days, start_time, end_time,
     location, building_code, max_seats, open_seats, term)
  VALUES
    (@course_id, @section_code, @instructor, @days, @start_time, @end_time,
     @location, @building_code, @max_seats, @open_seats, @term)
`);

function parseBuildingCode(location) {
  const match = location.match(/\(([^)]+)\)/);
  return match ? match[1] : 'UNT';
}

function splitCourseNumber(raw) {
  const subject = raw.replace(/\d.*/, '');
  const number  = raw.replace(/^[A-Z]+/, '');
  return { subject, number };
}

const csv = fs.readFileSync(
  path.join(__dirname, '../data/compD.csv'), 'utf8'
);

const lines = csv.trim().split('\n');
// skip header row
const rows = lines.slice(1);

const seed = db.transaction(() => {
  for (const line of rows) {
    // Split carefully — location can contain commas
    const [course_number, section_number, professor, start_time, end_time, days, ...rest] = line.split(',');
    const location = rest.join(',').trim();

    const { subject, number } = splitCourseNumber(course_number.trim());

    insertCourse.run({
      subject,
      number,
      title: `${subject} ${number}`,
      credits: 3,
    });

    const course = getCourse.get(subject, number);

    insertSection.run({
      course_id:    course.id,
      section_code: section_number.trim(),
      instructor:   professor.trim(),
      days:         days.trim(),
      start_time:   start_time.trim(),
      end_time:     end_time.trim(),
      location:     location,
      building_code: parseBuildingCode(location),
      max_seats:    30,
      open_seats:   Math.floor(Math.random() * 20) + 5,
      term:         '2025FA',
    });
  }
});

seed();
console.log(` Seeded ${rows.length} sections.`);