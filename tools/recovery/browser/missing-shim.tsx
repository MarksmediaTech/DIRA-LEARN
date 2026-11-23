// Placeholders for packages that are not installed here and are only used by pages these screen tests never open
// (forms on the application page, charts on the analytics pages). Opening such a page in the harness shows a notice.
const Unavailable = () => <p data-harness="unavailable">Not available in the test harness.</p>;
export const Bar = Unavailable, BarChart = Unavailable, CartesianGrid = Unavailable, Legend = Unavailable, Line = Unavailable, LineChart = Unavailable,
  ResponsiveContainer = Unavailable, Tooltip = Unavailable, XAxis = Unavailable, YAxis = Unavailable;
export function useForm(): never { throw new Error('react-hook-form is not available in the test harness'); }
export const zodResolver = () => () => ({ values: {}, errors: {} });
