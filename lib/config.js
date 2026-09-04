// ── STRIP GEOMETRY ──
// Number of frames per strip. Changing this value is safe: every loop,
// progress indicator and canvas calculation derives from it.
export const PHOTO_COUNT = 4;

// Each frame is 4:3 (landscape). Capture is centre-cropped to this exact
// ratio so a frame is never stretched when drawn into the strip.
export const FRAME_ASPECT = 4 / 3;

// Output resolution per frame. 1400px wide @ 4:3 gives ~300dpi at the
// printed 2in strip width, which is what the print lab needs.
export const CAPTURE_WIDTH = 1400;
export const CAPTURE_HEIGHT = Math.round(CAPTURE_WIDTH / FRAME_ASPECT);

// Requested camera resolution. We ask for more than we need so the
// centre-crop has pixels to spare; the browser downgrades if unsupported.
export const IDEAL_VIDEO_WIDTH = 1920;
export const IDEAL_VIDEO_HEIGHT = 1440;

// ── CAPTURE TIMING ──
export const COUNTDOWN_SECONDS = 3;
export const DEVELOPING_MS = 1200;

// ── PRICING (cents) ──
export const UNIT_PRICE = 1000;
export const SHIPPING = 0;
export const MAX_QTY = 20;

// ── PAYMENTS ──
// No live payment processor is wired up yet. While this is true the UI
// must not imply that a customer has been charged or that an order will
// ship. Set to false only once a real PaymentIntent flow is in place.
export const TEST_MODE = true;

// ── STRIP APPEARANCE ──
// White only while production ramps. Re-adding a colour is a one-line
// change here — the picker auto-shows once there is more than one, and
// the server validates against these keys.
export const BG_COLORS = { white: '#F5F0E8' };
export const BG_TEXT_COLORS = { white: '#2A2520' };

export const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];
