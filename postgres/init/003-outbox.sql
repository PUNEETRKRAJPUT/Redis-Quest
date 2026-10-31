-- Change data capture, the poor man's Debezium: triggers write one outbox row per change, a worker
-- (Chapter 2, prefetch cache) drains rows where published_at IS NULL into a Redis stream.
-- This file runs after the seed on purpose, so loading the seed does not flood the outbox.

CREATE TABLE outbox (
  id bigserial PRIMARY KEY,
  aggregate text NOT NULL,
  aggregate_id text NOT NULL,
  op text NOT NULL CHECK (op IN ('insert', 'update', 'delete')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
COMMENT ON TABLE outbox IS 'Pending change events for the CDC worker; payload is the full new row (old row on delete).';
CREATE INDEX outbox_unpublished_idx ON outbox (published_at) WHERE published_at IS NULL;

CREATE FUNCTION outbox_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := to_jsonb(OLD);
  ELSE
    r := to_jsonb(NEW);
  END IF;
  INSERT INTO outbox (aggregate, aggregate_id, op, payload)
  VALUES (TG_TABLE_NAME, r ->> 'id', lower(TG_OP), r);
  RETURN NULL; -- AFTER trigger, return value ignored
END;
$$;

CREATE TRIGGER players_outbox AFTER INSERT OR UPDATE OR DELETE ON players FOR EACH ROW EXECUTE FUNCTION outbox_capture();
CREATE TRIGGER teams_outbox AFTER INSERT OR UPDATE OR DELETE ON teams FOR EACH ROW EXECUTE FUNCTION outbox_capture();
CREATE TRIGGER matches_outbox AFTER INSERT OR UPDATE OR DELETE ON matches FOR EACH ROW EXECUTE FUNCTION outbox_capture();
CREATE TRIGGER contests_outbox AFTER INSERT OR UPDATE OR DELETE ON contests FOR EACH ROW EXECUTE FUNCTION outbox_capture();
