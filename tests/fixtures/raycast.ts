export const environment = { supportPath: process.env.CLI_AGENT_TEST_SUPPORT! };
export const Toast = { Style: { Failure: "failure" } };
export async function showToast() {}
export function getPreferenceValues() {
  return JSON.parse(process.env.CLI_AGENT_TEST_PREFERENCES || "{}");
}
const values = new Map<string, string>();
export const LocalStorage = {
  async getItem(key: string) {
    return values.get(key);
  },
  async setItem(key: string, value: string) {
    values.set(key, value);
  },
};
