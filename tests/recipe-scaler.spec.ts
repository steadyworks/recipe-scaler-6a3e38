import { test, expect, type Page } from '@playwright/test'

const BASE = 'http://localhost:3000'
const BACKEND = 'localhost:3001'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fill a single ingredient row by index (0-based).
 * Assumes the row already exists in the DOM.
 */
async function fillIngredientRow(
  page: Page,
  index: number,
  quantity: string,
  unit: string,
  name: string,
) {
  await page.getByTestId('ingredient-quantity').nth(index).fill(quantity)
  await page.getByTestId('ingredient-unit').nth(index).fill(unit)
  await page.getByTestId('ingredient-name').nth(index).fill(name)
}

/**
 * Click save-btn and wait for the backend to acknowledge the request before
 * returning, so callers can safely navigate away immediately after.
 */
async function saveRecipe(page: Page) {
  const response = page.waitForResponse(
    (r) => r.url().includes(BACKEND) && r.status() < 400,
  )
  await page.getByTestId('save-btn').click()
  await response
}

// ---------------------------------------------------------------------------
// TC-01: Servings scaling updates ingredient quantities proportionally
// ---------------------------------------------------------------------------

test(
  'TC-01: servings scaling updates ingredient quantities proportionally',
  async ({ page }) => {
    await page.goto(BASE)

    await page.getByTestId('recipe-title-input').fill('Pancakes')
    await page.getByTestId('base-servings-input').fill('4')

    // First ingredient row — already present on page load
    await fillIngredientRow(page, 0, '200', 'g', 'flour')

    // Append a second ingredient row and fill it
    await page.getByTestId('add-ingredient-btn').click()
    await fillIngredientRow(page, 1, '2', 'cups', 'milk')

    // Scale: target 8, base 4 → factor 2
    await page.getByTestId('target-servings-input').fill('8')

    // 200 × 2 = 400 (unit may be appended, e.g. "400g" or "400 g")
    await expect(page.getByTestId('scaled-quantity').first()).toHaveText(/400/)

    // 2 × 2 = 4 (unit may follow, e.g. "4 cups" or "4cups", but NOT "40" / "400")
    await expect(page.getByTestId('scaled-quantity').nth(1)).toHaveText(
      /^4(?:\D|$)/,
    )
  },
  { timeout: 20_000 },
)

// ---------------------------------------------------------------------------
// TC-02: Metric to imperial unit conversion
// ---------------------------------------------------------------------------

test(
  'TC-02: metric to imperial unit conversion',
  async ({ page }) => {
    await page.goto(BASE)

    await page.getByTestId('base-servings-input').fill('4')
    await fillIngredientRow(page, 0, '200', 'g', 'flour')

    // No scaling: target equals base
    await page.getByTestId('target-servings-input').fill('4')

    // Switch to imperial
    await page.getByTestId('unit-toggle').click()

    // Wait until the displayed value is no longer the original metric quantity
    await expect(page.getByTestId('scaled-quantity').first()).not.toHaveText(
      /200/,
    )

    // Extract the numeric portion and verify ≈ 7.05 oz (±0.1)
    const scaledText =
      (await page.getByTestId('scaled-quantity').first().textContent()) ?? ''
    const match = scaledText.match(/[\d.]+/)
    expect(match).not.toBeNull()
    const value = parseFloat(match![0])
    expect(value).toBeGreaterThanOrEqual(6.95)
    expect(value).toBeLessThanOrEqual(7.15)
  },
  { timeout: 20_000 },
)

// ---------------------------------------------------------------------------
// TC-03: Saved recipe persists across a page reload
// ---------------------------------------------------------------------------

test(
  'TC-03: saved recipe persists across a page reload',
  async ({ page }) => {
    await page.goto(BASE)

    await page.getByTestId('recipe-title-input').fill('Banana Bread')
    await page.getByTestId('base-servings-input').fill('6')
    await fillIngredientRow(page, 0, '3', 'cups', 'flour')

    await saveRecipe(page)

    // Navigate to the cookbook and verify the recipe is listed
    await page.goto(`${BASE}/cookbook`)
    await expect(
      page.getByTestId('cookbook-item-title').filter({ hasText: 'Banana Bread' }),
    ).toBeVisible()

    // Hard reload — the entry must survive (server-side persistence)
    await page.reload()
    await expect(
      page.getByTestId('cookbook-item-title').filter({ hasText: 'Banana Bread' }),
    ).toBeVisible()

    // Empty-state element must NOT be visible when recipes exist
    await expect(page.getByTestId('empty-cookbook')).not.toBeVisible()
  },
  { timeout: 30_000 },
)

// ---------------------------------------------------------------------------
// TC-04: Share URL restores the full recipe in a new tab
// ---------------------------------------------------------------------------

test(
  'TC-04: share URL restores the full recipe in a new tab',
  async ({ page, context }) => {
    await page.goto(BASE)

    await page.getByTestId('recipe-title-input').fill('Waffles')
    await page.getByTestId('base-servings-input').fill('2')
    await fillIngredientRow(page, 0, '150', 'g', 'flour')

    await page.getByTestId('add-ingredient-btn').click()
    await fillIngredientRow(page, 1, '120', 'ml', 'milk')

    await page.getByTestId('share-btn').click()

    // Share URL element must be visible and non-empty
    const shareUrlEl = page.getByTestId('share-url')
    await expect(shareUrlEl).toBeVisible()
    const rawUrl = (await shareUrlEl.textContent()) ?? ''
    const shareUrl = rawUrl.trim()
    expect(shareUrl.length).toBeGreaterThan(0)

    // Handle both absolute and relative URLs
    const fullUrl = shareUrl.startsWith('http') ? shareUrl : `${BASE}${shareUrl}`

    // Open the share URL in a new tab within the same browser context
    const newPage = await context.newPage()
    await newPage.goto(fullUrl)

    // Recipe fields must be restored
    await expect(newPage.getByTestId('recipe-title-input')).toHaveValue('Waffles')
    await expect(newPage.getByTestId('base-servings-input')).toHaveValue('2')

    // Both ingredient rows must be present with correct name and quantity
    const nameInputs = newPage.getByTestId('ingredient-name')
    const qtyInputs = newPage.getByTestId('ingredient-quantity')
    const count = await nameInputs.count()

    let flourFound = false
    let milkFound = false
    for (let i = 0; i < count; i++) {
      const name = await nameInputs.nth(i).inputValue()
      const qty = await qtyInputs.nth(i).inputValue()
      if (name === 'flour' && qty === '150') flourFound = true
      if (name === 'milk' && qty === '120') milkFound = true
    }
    expect(flourFound, 'flour row with quantity 150 not found').toBe(true)
    expect(milkFound, 'milk row with quantity 120 not found').toBe(true)
  },
  { timeout: 30_000 },
)

// ---------------------------------------------------------------------------
// TC-05: Print view displays recipe content and no editor chrome
// ---------------------------------------------------------------------------

test(
  'TC-05: print view displays recipe content and no editor chrome',
  async ({ page }) => {
    await page.goto(BASE)

    await page.getByTestId('recipe-title-input').fill('Cookies')
    await page.getByTestId('base-servings-input').fill('24')
    await fillIngredientRow(page, 0, '250', 'g', 'flour')

    await page.getByTestId('print-btn').click()

    // Must have navigated to the print route
    await expect(page).toHaveURL(/\/print/)

    // Recipe content must be present
    await expect(page.getByTestId('print-title')).toBeVisible()
    await expect(page.getByTestId('print-title')).toContainText('Cookies')
    await expect(page.getByTestId('print-servings')).toBeVisible()
    await expect(page.getByTestId('print-ingredient-list')).toBeVisible()
    await expect(page.getByTestId('print-ingredient-row').first()).toBeVisible()

    // Editor chrome must NOT be visible on the print page
    await expect(page.getByTestId('save-btn')).not.toBeVisible()
    await expect(page.getByTestId('share-btn')).not.toBeVisible()
    await expect(page.getByTestId('unit-toggle')).not.toBeVisible()
    await expect(page.getByTestId('add-ingredient-btn')).not.toBeVisible()
  },
  { timeout: 20_000 },
)

// ---------------------------------------------------------------------------
// TC-06: Delete a recipe from the cookbook
// ---------------------------------------------------------------------------

test(
  'TC-06: delete a recipe from the cookbook',
  async ({ page }) => {
    await page.goto(BASE)

    await page.getByTestId('recipe-title-input').fill('Guacamole')
    await page.getByTestId('base-servings-input').fill('4')
    await fillIngredientRow(page, 0, '2', 'whole', 'avocados')

    await saveRecipe(page)

    await page.goto(`${BASE}/cookbook`)

    // Identify the Guacamole card and confirm it is visible
    const guacItem = page.getByTestId('cookbook-item').filter({
      has: page.getByTestId('cookbook-item-title').filter({ hasText: 'Guacamole' }),
    })
    await expect(guacItem).toBeVisible()

    // Delete the entry and wait for the backend to confirm
    const deleteResponse = page.waitForResponse(
      (r) => r.url().includes(BACKEND) && r.status() < 400,
    )
    await guacItem.getByTestId('delete-recipe-btn').click()
    await deleteResponse

    // Guacamole entry must be gone
    await expect(
      page.getByTestId('cookbook-item-title').filter({ hasText: 'Guacamole' }),
    ).not.toBeVisible()
  },
  { timeout: 30_000 },
)

// ---------------------------------------------------------------------------
// TC-07: Load a saved recipe back into the editor
// ---------------------------------------------------------------------------

test(
  'TC-07: load a saved recipe back into the editor',
  async ({ page }) => {
    await page.goto(BASE)

    await page.getByTestId('recipe-title-input').fill('French Toast')
    await page.getByTestId('base-servings-input').fill('2')
    await fillIngredientRow(page, 0, '4', 'slices', 'bread')

    await saveRecipe(page)

    await page.goto(`${BASE}/cookbook`)

    // Locate the French Toast card
    const frenchToastItem = page.getByTestId('cookbook-item').filter({
      has: page.getByTestId('cookbook-item-title').filter({ hasText: 'French Toast' }),
    })
    await expect(frenchToastItem).toBeVisible()

    // Load the recipe back into the editor
    await frenchToastItem.getByTestId('load-recipe-btn').click()

    // Must navigate away from /cookbook (to the editor at /)
    await expect(page).not.toHaveURL(/\/cookbook/)

    // All recipe fields must be pre-filled
    await expect(page.getByTestId('recipe-title-input')).toHaveValue('French Toast')
    await expect(page.getByTestId('base-servings-input')).toHaveValue('2')

    // At least one ingredient row must contain 'bread'
    const nameInputs = page.getByTestId('ingredient-name')
    const count = await nameInputs.count()
    let breadFound = false
    for (let i = 0; i < count; i++) {
      const val = await nameInputs.nth(i).inputValue()
      if (val.includes('bread')) {
        breadFound = true
        break
      }
    }
    expect(breadFound, 'ingredient row with name "bread" not found').toBe(true)
  },
  { timeout: 30_000 },
)
