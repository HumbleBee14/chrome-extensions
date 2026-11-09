export async function setChoices(page, id, values) {
  const editor = page.locator(`#${id}`);
  while ((await editor.locator("input[data-reason]").count()) > values.length)
    await editor.locator("button.remove-choice").last().click();
  while ((await editor.locator("input[data-reason]").count()) < values.length)
    await editor
      .getByRole("button", { name: "Add choice", exact: true })
      .click();
  for (let index = 0; index < values.length; index++)
    await editor.locator("input[data-reason]").nth(index).fill(values[index]);
}
export async function choices(page, id) {
  return page
    .locator(`#${id} input[data-reason]`)
    .evaluateAll((inputs) => inputs.map((input) => input.value));
}
