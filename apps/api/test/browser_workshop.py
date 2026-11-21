"""Exercise a full wall-clock shift on the disposable local Supabase stack."""
import json
import os
from pathlib import Path
from uuid import uuid4

from playwright.sync_api import expect, sync_playwright


API = "http://127.0.0.1:8080"
GAME = "http://127.0.0.1:4173"


def rehearse(browser, screenshots):
    ctx = browser.new_context(
        viewport={"width": 1440, "height": 950},
        permissions=["clipboard-read", "clipboard-write"],
    )
    errors = []
    ctx.on("page", lambda page: page.on("pageerror", lambda error: errors.append(str(error))))
    organiser = ctx.new_page()
    organiser.on("dialog", lambda dialog: dialog.accept())
    organiser.goto(API + "/organiser")
    organiser.get_by_label("Username").fill(os.environ["ORGANISER_USERNAME"])
    organiser.get_by_label("Password", exact=True).fill(os.environ["TEST_ORGANISER_PASSWORD"])
    organiser.get_by_role("button", name="Sign in").click()
    form = organiser.locator("#new")
    if not form.is_visible():
        organiser.get_by_text("Create a workshop", exact=True).click()
    code = uuid4().hex[:12]
    form.get_by_label("Workshop title").fill("Midnight Helsinki")
    form.get_by_label("Join code").fill(code)
    form.get_by_role("button", name="Create workshop").click()
    expect(organiser.locator("#manage h2").first).to_have_text("Midnight Helsinki")
    workshop = organiser.locator("#workshop").input_value()
    organiser.locator("#round").click()
    expect(organiser.locator("#round")).to_have_text("End entry window")

    registration = ctx.new_page()
    registration.goto(API + "/join#code=" + code)
    registration.get_by_label("Player name").fill("Aurora")
    registration.get_by_role("button", name="Join competition").click()
    registration.locator("#copy").click()
    expect(registration.locator("#notice")).to_contain_text("copied")
    credentials = registration.evaluate("navigator.clipboard.readText()")
    registration.reload()
    expect(registration.locator("#saved")).to_contain_text("Aurora")

    game = ctx.new_page()
    game.goto(GAME)
    game.locator("#officialTab").click()
    game.locator("#connection").select_option("import")
    game.locator("#credentials").fill(credentials)
    game.get_by_role("button", name="Join or resume").click()
    expect(game.locator("#modeTag")).to_have_text("Official shift")
    game.locator("#play").click()

    # The public observer has no participant or organiser session.
    public = browser.new_context(viewport={"width": 1440, "height": 950})
    board = public.new_page()
    board.goto(API + "/board/" + workshop)
    expect(board.locator("#ranks")).to_contain_text("Aurora")
    expect(board.locator("#sync")).to_contain_text("Live", timeout=60000)
    organiser.locator("#round").click()
    expect(organiser.locator("#round")).to_be_disabled()
    expect(board.locator(".score")).not_to_have_text("0", timeout=90000)
    public.set_offline(True)
    public.set_offline(False)
    board.reload()
    expect(board.locator("#sync")).to_contain_text("Live", timeout=60000)
    expect(board.locator(".score")).not_to_have_text("0")
    game.screenshot(path=screenshots / "official.jpg", quality=82)
    board.screenshot(path=screenshots / "standings.jpg", quality=82)
    organiser.locator("#refresh").click()
    expect(organiser.locator(".scroll table")).to_contain_text("Aurora")
    organiser.screenshot(path=screenshots / "organiser.jpg", quality=82)

    expect(game.locator("#network")).to_contain_text("Score verified", timeout=430000)
    score = int(game.locator("#score").inner_text())
    result = board.request.get(API + "/workshops/" + workshop + "/display").json()
    entry = result["entries"][0]
    assert result["final"] and entry["finalised"] and entry["score"] == score
    assert game.get_by_text("Central leaderboard").get_attribute("href") == board.url
    game.screenshot(path=screenshots / "verified.jpg", quality=82)
    board.set_viewport_size({"width": 1920, "height": 1080})
    board.goto(API + "/projector/" + workshop)
    expect(board.locator("#title")).to_have_text("Aurora")
    board.locator("#full").click()
    board.wait_for_function("!!document.fullscreenElement")
    board.screenshot(path=screenshots / "projector.jpg", quality=82)
    assert not errors, errors
    print(json.dumps(entry))


if __name__ == "__main__":
    output = Path(os.environ["EMBASSY_QA_DIR"])
    output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as runner:
        browser = runner.chromium.launch(executable_path=os.getenv("CHROMIUM_PATH"))
        try:
            rehearse(browser, output)
        finally:
            browser.close()
