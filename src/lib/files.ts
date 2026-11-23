// Uploaded files can be opened only after a clean virus scan (migrations 29 and 35). The database hides a file that is still
// waiting, failed or was found infected, so creating a link fails; this is the message people see then.
export const FILE_NOT_AVAILABLE =
  'This file cannot be opened yet. Every upload is checked for viruses first; it is still waiting for that check, or the check found a problem. Try again later.';
