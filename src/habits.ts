export interface HabitDefinition {
  key: string;
  title: string;
  cue?: string;
}

export interface HabitMetric extends HabitDefinition {
  unit: string;
  target: number;
  direction: "at_least" | "at_most" | "under";
  step: number;
}

export interface HabitLaw {
  number: number;
  make: string;
  inverse: string;
  build: string[];
  break: string[];
}

export const DAILY_HABITS: HabitDefinition[] = [
  { key: "daily_fajr", title: "Fajr on time", cue: "Prayer is the first anchor of the day." },
  { key: "daily_morning_azkaar", title: "Morning Azkaar" },
  { key: "daily_affirmation", title: "Morning affirmation read aloud" },
  { key: "daily_quran", title: "Read 1 Juz of Qur’an" },
  { key: "daily_no_social_before_dhuhr", title: "No social media before Dhuhr" },
  { key: "daily_deep_work", title: "Complete a 3-hour learning / deep-work block" },
  { key: "daily_exam_study", title: "Complete exam or compliance study" },
  { key: "daily_steps", title: "Walk 10,000+ steps" },
  { key: "daily_book", title: "Read a book for 30 minutes" },
  { key: "daily_evening_azkaar", title: "Evening Azkaar" },
  { key: "daily_journal", title: "Write one journal line or poem stanza" },
  { key: "daily_screen_time", title: "Keep screen time under 4 hours" },
];

export const DAILY_METRICS: HabitMetric[] = [
  { key: "metric_steps", title: "Steps", unit: "steps", target: 10000, direction: "at_least", step: 100 },
  { key: "metric_learning", title: "Learning", unit: "hours", target: 3, direction: "at_least", step: 0.25 },
  { key: "metric_tiktok", title: "TikTok", unit: "minutes", target: 60, direction: "at_most", step: 1 },
  { key: "metric_screen_time", title: "Screen time", unit: "hours", target: 4, direction: "under", step: 0.25 },
  { key: "metric_agent_onboarding", title: "Agent onboarding", unit: "agents", target: 3, direction: "at_least", step: 1 },
  { key: "metric_book", title: "Book reading", unit: "minutes", target: 30, direction: "at_least", step: 5 },
  { key: "metric_quran", title: "Qur’an", unit: "Juz", target: 1, direction: "at_least", step: 0.25 },
];

export const WEEKLY_HABITS: HabitDefinition[] = [
  { key: "weekly_training", title: "Complete 4–5 gym or bodyweight sessions" },
  { key: "weekly_interviews", title: "Complete 5–10 user interviews" },
  { key: "weekly_dashboard", title: "Update the Proton dashboard" },
  { key: "weekly_giving", title: "Complete one giving action" },
  { key: "weekly_not_to_do", title: "Review the “What Not to Do” list" },
  { key: "weekly_screen_review", title: "Review the Screen Time average" },
  { key: "weekly_lessons", title: "Review wins, failures, and lessons" },
  { key: "weekly_priorities", title: "Set next week’s top three priorities" },
];

export const HABIT_LAWS: HabitLaw[] = [
  {
    number: 1,
    make: "Make it obvious",
    inverse: "Make it invisible",
    build: [
      "Write down current habits to become aware of them.",
      "Use an implementation intention: I will [behavior] at [time] in [location].",
      "Stack habits: After [current habit], I will [new habit].",
      "Design the environment with visible cues.",
    ],
    break: ["Reduce exposure and remove cues from the environment."],
  },
  {
    number: 2,
    make: "Make it attractive",
    inverse: "Make it unattractive",
    build: [
      "Bundle an action you need with an action you want.",
      "Join a culture where the desired behavior is normal.",
      "Do something enjoyable immediately before the habit.",
    ],
    break: ["Reframe the mindset and highlight the benefits of avoiding the habit."],
  },
  {
    number: 3,
    make: "Make it easy",
    inverse: "Make it difficult",
    build: [
      "Reduce friction and the number of steps before the habit.",
      "Prime the environment in advance.",
      "Master the decisive moments.",
      "Downscale the habit to the two-minute rule.",
      "Automate what can be automated.",
    ],
    break: [
      "Increase friction and the number of steps before the habit.",
      "Use a commitment device to restrict future choices.",
    ],
  },
  {
    number: 4,
    make: "Make it satisfying",
    inverse: "Make it unsatisfying",
    build: [
      "Use immediate reinforcement.",
      "Design the habit to be enjoyable.",
      "Use a habit tracker.",
      "Never miss twice.",
    ],
    break: [
      "Use an accountability partner.",
      "Create a habit contract that makes the cost visible and immediate.",
    ],
  },
];

export const SOCIAL_MEDIA_RULES = [
  "Delete each social media app immediately after using it; keep none installed overnight.",
  "No social media before Dhuhr, and no browser workaround.",
  "TikTok is limited to 60 minutes; Facebook, Snapchat, and X are purpose-only.",
  "Disable social notifications and open social media only with a defined purpose.",
  "Keep the phone out of deep work, bed, meals, walks, reading, Qur’an, and Salah windows.",
  "Check and record Screen Time every night.",
];

export const DEEP_WORK_RULES = [
  "Keep the phone outside reach.",
  "Write the objective before starting and work on one task at a time.",
  "No email, messages, news, or random browsing during the block.",
  "When distracted, write the thought down and return to work.",
  "Finish the scheduled block after motivation fades.",
  "Entertainment comes after the day’s important work.",
];

export const HABIT_INSIGHTS = [
  "Goals describe the result; systems produce it.",
  "Commitment to the process determines progress.",
  "Lasting behavior change follows identity change.",
  "Decide who you want to become, then prove it with small wins.",
  "Environment is the invisible hand shaping behavior.",
  "Anticipation of a reward is what moves us to act.",
];

export const HABIT_RESOURCES = [
  { label: "Habits cheat sheet", url: "https://s3.amazonaws.com/jamesclear/Atomic+Habits/Habits+Cheat+Sheet.pdf" },
  { label: "Cycling case study", url: "https://jamesclear.com/atomic-habits/cycling" },
  { label: "Habits scorecard", url: "https://s3.amazonaws.com/jamesclear/Atomic+Habits/The+Habits+Scorecard.pdf" },
  { label: "Habit stacking", url: "https://s3.amazonaws.com/jamesclear/Atomic+Habits/Habit+Stack.pdf" },
  { label: "Habit journal", url: "https://jamesclear.com/habit-journal" },
  { label: "Habit tracker", url: "https://s3.amazonaws.com/jamesclear/Atomic+Habits/Habit+Tracker.pdf" },
  { label: "Habit contract", url: "https://s3.amazonaws.com/jamesclear/Atomic+Habits/Habit+Contract.pdf" },
];

export const HABIT_KEYS = new Set([
  ...DAILY_HABITS.map((habit) => habit.key),
  ...DAILY_METRICS.map((metric) => metric.key),
  ...WEEKLY_HABITS.map((habit) => habit.key),
]);

export function habitCatalog() {
  return {
    daily: DAILY_HABITS,
    metrics: DAILY_METRICS,
    weekly: WEEKLY_HABITS,
    laws: HABIT_LAWS,
    socialMediaRules: SOCIAL_MEDIA_RULES,
    deepWorkRules: DEEP_WORK_RULES,
    insights: HABIT_INSIGHTS,
    resources: HABIT_RESOURCES,
  };
}
