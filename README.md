# Asphalt Care Services app

A mobile-friendly web app for [Asphalt Care Services, LLC](https://www.asphaltcareservices.com/) in Stuart, FL, built from the content on their website.

- Tap-to-call, email and directions
- Services grouped into paving, repair and maintenance, linking to the full pages on the website
- Pavement checkup: tap what you're seeing (cracks, potholes, faded lines…) to get recommended services, then send them straight into an estimate request
- Free estimate form with optional photo uploads, handled by Netlify Forms
- Client testimonials and service areas

## Files

- `index.html`: page structure and the estimate form
- `style.css`: styling
- `app.js`: services, checkup, reviews and areas data, plus form handling

## Deploy to Netlify

There is no build step. Deploy this branch with the build command left blank and the publish directory set to the repository root.

Estimate requests show up in the Netlify dashboard under **Forms → estimate**. To get them by email, add a form notification there (Site configuration → Notifications → Emails and webhooks).

The logo and app icon load from asphaltcareservices.com. If the logo can't load, the app shows the company name as text instead.
