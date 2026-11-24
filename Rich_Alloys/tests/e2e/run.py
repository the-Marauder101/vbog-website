import re, sys
from playwright.sync_api import sync_playwright, expect
URL = "http://localhost:54321/"
errs = []
def ctx(b, w=390, h=844):
    c = b.new_context(viewport={"width": w, "height": h}); p = c.new_page()
    p.on("pageerror", lambda e: errs.append(f"pageerror {e}"))
    p.on("console", lambda m: errs.append(f"console {m.text}") if m.type == "error" else None)
    p.on("dialog", lambda d: d.accept())
    return c, p
def login(p, email):
    p.goto(URL); p.get_by_label("Email").fill(email); p.get_by_label("Password").fill("pw")
    p.get_by_role("button", name="Sign in").click(); p.wait_for_selector("text=Your work")
def sheet(p): return p.locator(".sheet")
def step(n): print("·", n, flush=True)

with sync_playwright() as pw:
    b = pw.chromium.launch()
    # ---------- Tinu: deal -> arrival -> sorting -> close -> DNs -> Tally -> payment ----------
    c, p = ctx(b); login(p, "tinu@t"); step("tinu signed in")
    p.screenshot(path="01_tinu_home.png", full_page=True)
    p.goto(URL + "#/lots/new"); s = sheet(p)
    s.get_by_label("Supplier").select_option(label="Ogo Enviro Solutions Private Limited")
    s.get_by_label("Grade").select_option(label="OC")
    s.get_by_label("Agreed weight").fill("2000"); s.get_by_label(re.compile(r"^Rate")).fill("1200")
    s.get_by_role("button", name=re.compile("Payment terms for this deal")).click()
    s.get_by_label("Provisional").fill("90"); s.get_by_label("Paid after").fill("0"); s.get_by_label("Balance after").fill("20")
    p.screenshot(path="02_new_deal.png", full_page=True)
    s.get_by_role("button", name="Save deal").click()
    p.wait_for_selector("text=Material arrived: record it"); step("deal booked")
    # the PO is issued from the booked deal, numbered from the last one, and downloaded as a PDF
    p.get_by_role("button", name="Issue PO", exact=True).click()
    assert p.get_by_label("PO number").input_value().startswith("PO/RA/083/"), p.get_by_label("PO number").input_value()
    p.get_by_label("PO number").fill("PO/RA/090/26-27")
    with p.expect_download() as dl:
        p.get_by_role("button", name="Issue PO and download PDF").click()
    assert dl.value.suggested_filename == "PO_RA_090_26-27.pdf", dl.value.suggested_filename
    p.wait_for_selector("text=PO PO/RA/090/26-27"); p.wait_for_selector(".toast"); step("PO issued, PDF downloaded, saved confirmation shown")
    p.get_by_role("button", name="Material arrived: record it").click(); s = sheet(p)
    s.get_by_label("Vehicle number").fill("mh04ab1234")
    s.get_by_label("Supplier invoice number").fill("OGOES22")
    s.locator("label.upload input").set_input_files("invoice.jpg")
    s.get_by_label("Weight on invoice").fill("2000"); s.get_by_label(re.compile(r"^Rate on invoice")).fill("1200")   # typed from the invoice, never pre-filled
    s.get_by_label(re.compile(r"^Gross")).fill("2010"); s.get_by_label("Number of bags").fill("50"); s.get_by_label("Weight of all bags").fill("15")
    expect(s.locator(".result.ok")).to_contain_text("Invoice matches the PO weight")   # P2 = P1
    expect(s.locator(".result.bad")).to_contain_text("Our net (gross − bags) 1,995.000 kg · Short 5.000 kg")   # P3 2,010 − bags 15 = P4; P2 − P4
    p.screenshot(path="03_arrival.png", full_page=True)
    s.get_by_role("button", name="Save arrival").click()
    p.wait_for_selector(".stepper"); step("arrival saved, lot opened")
    lot_url = p.url
    p.get_by_role("tab", name=re.compile("Sorting")).click()
    for cat, kgv, cut in [("Mitti", "10", None), ("Lead copper", "20", "50")]:
        p.get_by_role("button", name="+ Add sorting result").click(); s = sheet(p)
        s.get_by_role("radio", name=re.compile(cat)).click(); s.get_by_label(re.compile(r"^Weight")).fill(kgv)
        if cut: s.get_by_label("Rate cut").fill(cut)
        s.get_by_role("button", name="Save and close").click(); p.wait_for_selector(".sheet", state="detached")
    p.screenshot(path="04_sorting.png", full_page=True); step("sorting entered")
    p.get_by_role("button", name=re.compile("Sorting finished")).click(); p.wait_for_selector("text=Reopen sorting")
    p.get_by_role("tab", name=re.compile("Debit notes")).click()
    p.wait_for_selector(".note-card")
    p.screenshot(path="05_dn_before.png", full_page=True)
    for i in range(3):
        p.locator(".note-card:not(.approved)").first.get_by_role("button", name=re.compile("Approve debit note")).click()
        p.wait_for_function(f"document.querySelectorAll('.note-card.approved').length >= {i+1}")
    totals = p.locator(".note-card .kv").all_inner_texts()
    print("DN totals:", [re.findall(r"Total\s*\n?\s*(₹[\d,\.]+)", x) for x in totals])
    p.locator(".note-card").first.get_by_label("Debit note number from Tally").fill("RAI/DN/26-27/130")
    p.locator(".note-card").first.get_by_role("button", name="Save").click(); p.wait_for_timeout(400)
    p.screenshot(path="06_dn_after.png", full_page=True); step("DNs approved")
    lot_id = p.url.split("#/lot/")[1].split("/")[0]
    p.goto(URL + "#/tally/factory"); p.wait_for_selector("text=To enter")
    p.get_by_role("button", name=re.compile("Purchase invoice.*OGOES22")).click(); p.wait_for_selector(".voucher table")
    v = p.locator(".voucher").inner_text(); assert "IGST 18%" in v and "Copper scrap" in v, v
    p.screenshot(path="06b_tally_factory.png", full_page=True)
    p.get_by_label("Voucher number in Tally").fill("PUR-501"); p.get_by_role("button", name="✓ Entered").click(); p.wait_for_selector(".voucher", state="detached")
    p.get_by_role("button", name=re.compile("Debit note · Weight short")).first.click(); p.wait_for_selector(".voucher table")
    p.get_by_label("Voucher number in Tally").fill("DN-130"); p.get_by_role("button", name="✓ Entered").click(); p.wait_for_selector(".voucher", state="detached")
    step("factory Tally entries ticked from the queue")
    # a ticked DN is cancelled -> it comes back as "correct in Tally"
    p.goto(URL + f"#/lot/{lot_id}/dn"); p.wait_for_selector(".note-card")
    p.locator(".note-card").first.get_by_role("button", name="Cancel").click()
    p.locator(".note-card").first.locator("textarea").fill("Wrong bag weight"); p.get_by_role("button", name="Cancel debit note").click()
    p.wait_for_timeout(600); p.goto(URL + "#/tally/factory"); p.wait_for_selector("text=Changed after entry")
    p.screenshot(path="06c_tally_changed.png", full_page=True)
    p.get_by_role("button", name=re.compile("Cancelled or deleted")).click(); p.get_by_role("button", name="Corrected in Tally").click()
    p.wait_for_function("!document.body.innerText.includes('Changed after entry')"); step("cancelled DN flagged, then cleared")
    p.goto(URL + f"#/lot/{lot_id}/dn"); p.wait_for_selector(".note-card")
    p.locator(".note-card:not(.approved)").first.get_by_role("button", name=re.compile("Approve debit note")).click(); p.wait_for_timeout(600)
    p.get_by_role("tab", name="Payment").click()
    p.get_by_role("button", name="+ Record payment").click(); s = sheet(p)
    s.get_by_label("Amount paid").fill("2400000"); s.get_by_label("Bank reference / UTR").fill("UTR123")
    s.get_by_label(re.compile("^Income-tax TDS from")).fill("2400"); s.get_by_label(re.compile("^Income-tax TDS section")).fill("194q")
    s.get_by_role("button", name=re.compile("Save")).click(); p.wait_for_selector(".sheet", state="detached")
    p.screenshot(path="07_pay_tinu.png", full_page=True); step("payment recorded by Tinu")
    c.close()

    # ---------- Niti: reconcile, office Tally, ledger ----------
    c, p = ctx(b); login(p, "niti@t"); step("niti signed in")
    p.screenshot(path="08_niti_home.png", full_page=True)
    p.goto(URL + "#/payables/payments")
    p.get_by_role("button", name="Matches bank statement").first.click()
    # the section headings are always shown; wait until the waiting list is empty, i.e. the reconcile has saved
    p.wait_for_selector("text=Waiting for reconciliation (0)")
    p.goto(URL + "#/tally/office"); p.wait_for_selector("text=To enter")
    print("Office queue:", p.locator(".rows").last.inner_text().count("₹"), "items")
    p.get_by_role("button", name=re.compile("^Payment.*UTR123")).click(); p.wait_for_selector(".voucher .kv")
    assert "194Q" in p.locator(".voucher").inner_text()
    p.get_by_label("Voucher number in Tally").fill("PMT-77"); p.get_by_role("button", name="✓ Entered").click(); p.wait_for_selector(".voucher", state="detached")
    p.screenshot(path="08b_tally_office.png", full_page=True)
    p.goto(URL + "#/payables/payments")
    p.get_by_role("tab", name="Supplier ledgers").click(); p.get_by_role("button", name=re.compile("Ogo Enviro")).click(); s = sheet(p)
    bal = s.locator(".kv").inner_text(); print("Ledger:", bal.replace("\n", " | "))
    s.get_by_label("Balance in their ledger").fill("1"); s.get_by_role("button", name="Record check").click(); p.wait_for_selector(".sheet .warn")
    p.screenshot(path="09_ledger.png", full_page=True); step("niti reconciled + ledger checked")
    s.get_by_role("button", name="Close").click()
    assert p.get_by_role("tab", name="GSTR-2B").count() == 0; step("2B hidden by default")
    c.close()

    # ---------- Himanshu (desktop): cash plan, admin, stock ----------
    c, p = ctx(b, 1280, 900); login(p, "owner@t"); step("owner signed in")
    p.screenshot(path="10_owner_home_desktop.png", full_page=True)
    p.get_by_role("link", name="Payables").first.click(); p.wait_for_selector(".bars")
    print("Cash stats:", p.locator(".stats").inner_text().replace("\n", " | "))
    p.screenshot(path="11_cash_desktop.png", full_page=True)
    p.goto(URL + "#/admin/categories"); p.get_by_role("button", name="+ Add").click(); s = sheet(p)
    s.get_by_label(re.compile(r"^Name")).fill("Brass"); s.get_by_label("Hindi name").fill("पीतल"); s.get_by_label("Usually").select_option(label="Kept at a lower rate")
    s.get_by_role("button", name="Save").click(); p.wait_for_selector("text=BRASS")
    p.goto(URL + "#/admin/permissions"); p.wait_for_selector(".perm"); p.screenshot(path="12_permissions.png", full_page=True)
    p.goto(URL + "#/tally/register"); p.wait_for_selector(".tbl")
    print("Register:", p.locator(".tbl tbody").inner_text().replace("\t", " ").replace("\n", " | "))
    p.screenshot(path="12b_register.png", full_page=True)
    p.goto(URL + "#/stock"); p.wait_for_selector(".stock")
    p.get_by_role("button", name="+ Production").click(); s = sheet(p)
    s.locator(".line").nth(0).get_by_label("Weight").fill("1500"); s.locator(".line").nth(1).get_by_label("Weight").fill("1400")
    s.get_by_role("button", name="Save production").click(); p.wait_for_selector(".sheet", state="detached")
    p.locator("input[type=month]").fill("2026-11"); p.wait_for_timeout(600)
    print("Stock:", p.locator(".stock tbody").inner_text().replace("\t", " ").replace("\n", " | "))
    p.screenshot(path="13_stock_desktop.png", full_page=True); step("owner checks done")
    c.close()

    # ---------- Watchman: Hindi, no money ----------
    c, p = ctx(b, 360, 740); p.goto(URL); p.get_by_role("button", name="हिंदी").click()
    p.get_by_label("ईमेल").fill("gate@t"); p.get_by_label("पासवर्ड").fill("pw"); p.get_by_role("button", name="साइन इन").click(); p.wait_for_selector("text=आपका काम")
    nav = p.locator(".bottomnav").inner_text(); print("Gate nav:", nav.replace("\n", " "))
    assert "देनदारी" not in nav
    p.goto(lot_url.split("#")[0] + "#/" + lot_url.split("#/")[1].split("/")[0] + "/" + lot_url.split("#/")[1].split("/")[1] + "/docs"); p.wait_for_selector(".progress")
    p.screenshot(path="14_gate_docs_hi.png", full_page=True)
    c.close()

    # ---------- Sanjay: Hindi sorting on phone ----------
    c, p = ctx(b, 360, 740); p.goto(URL); p.get_by_role("button", name="हिंदी").click()
    p.get_by_label("ईमेल").fill("sanjay@t"); p.get_by_label("पासवर्ड").fill("pw"); p.get_by_role("button", name="साइन इन").click(); p.wait_for_selector("text=आपका काम")
    p.screenshot(path="15_sanjay_home_hi.png", full_page=True)
    p.goto(URL + "#/lots"); p.get_by_role("button", name=re.compile("L-0001")).click(); p.get_by_role("tab", name=re.compile("छँटाई")).click()
    p.screenshot(path="16_sanjay_sorting_hi.png", full_page=True)
    print("h-scroll at 360px:", p.evaluate("document.documentElement.scrollWidth > innerWidth"))
    c.close()
    b.close()
print("ERRORS:", errs[:10])
