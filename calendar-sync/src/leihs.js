// Reservations of models in a category with an Outlook calendar, including
// its subcategories. A model in several such categories gets one event per
// mailbox. Dates and times go out as text: they are local to the pool and
// must not be shifted by any time zone on the way.
const DESIRED_SQL = `
WITH RECURSIVE calendar_categories (id, mailbox) AS (
  SELECT id, outlook_calendar
  FROM model_groups
  WHERE type = 'Category' AND outlook_calendar IS NOT NULL
  UNION
  SELECT model_group_links.child_id, calendar_categories.mailbox
  FROM model_group_links
  JOIN calendar_categories ON calendar_categories.id = model_group_links.parent_id
)
SELECT DISTINCT
  reservations.id AS reservation_id,
  calendar_categories.mailbox,
  to_char(reservations.start_date, 'YYYY-MM-DD') AS start_date,
  to_char(reservations.end_date, 'YYYY-MM-DD') AS end_date,
  to_char(reservations.start_time, 'HH24:MI') AS start_time,
  to_char(reservations.end_time, 'HH24:MI') AS end_time,
  models.name AS model_name,
  concat_ws(' ', users.firstname, users.lastname) AS user_name,
  nullif(concat_ws(' ', delegated_users.firstname, delegated_users.lastname), '') AS delegated_user_name,
  -- Who made the reservation: in a delegation, the person acting for it.
  nullif(btrim(coalesce(delegated_users.email, users.email)), '') AS booker_email,
  coalesce(nullif(btrim(reservations.line_purpose), ''), orders.purpose) AS purpose,
  inventory_pools.name AS pool_name
FROM reservations
JOIN model_links ON model_links.model_id = reservations.model_id
JOIN calendar_categories ON calendar_categories.id = model_links.model_group_id
JOIN models ON models.id = reservations.model_id
JOIN users ON users.id = reservations.user_id
LEFT JOIN users AS delegated_users ON delegated_users.id = reservations.delegated_user_id
LEFT JOIN orders ON orders.id = reservations.order_id
JOIN inventory_pools ON inventory_pools.id = reservations.inventory_pool_id
WHERE reservations.type = 'ItemLine'
  AND reservations.status = ANY($1::text[])
  AND reservations.end_date >= $2::date
`;

const SYNCED_SQL = `
SELECT reservation_id, mailbox, event_id, fingerprint, calendar,
       to_char(ends_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS ends_at
FROM outlook_calendar_events
`;

const SAVE_SQL = `
INSERT INTO outlook_calendar_events (reservation_id, mailbox, event_id, fingerprint, ends_at, calendar)
VALUES ($1, $2, $3, $4, $5::timestamp, $6)
ON CONFLICT (reservation_id, mailbox) DO UPDATE
SET event_id = EXCLUDED.event_id,
    fingerprint = EXCLUDED.fingerprint,
    ends_at = EXCLUDED.ends_at,
    calendar = EXCLUDED.calendar,
    updated_at = now()
`;

const REMOVE_SQL = `
DELETE FROM outlook_calendar_events WHERE reservation_id = $1 AND mailbox = $2
`;

export function createLeihsDb(pool) {
  return {
    async desired(statuses, today) {
      const { rows } = await pool.query(DESIRED_SQL, [statuses, today]);
      return rows;
    },

    async synced() {
      const { rows } = await pool.query(SYNCED_SQL);
      return rows.map((row) => ({
        reservationId: row.reservation_id,
        mailbox: row.mailbox,
        eventId: row.event_id,
        fingerprint: row.fingerprint,
        endsAt: row.ends_at,
        calendar: row.calendar,
      }));
    },

    async save(item, eventId) {
      await pool.query(SAVE_SQL, [item.reservationId, item.mailbox, eventId, item.fingerprint, item.endsAt, item.calendar]);
    },

    async remove({ reservationId, mailbox }) {
      await pool.query(REMOVE_SQL, [reservationId, mailbox]);
    },
  };
}
