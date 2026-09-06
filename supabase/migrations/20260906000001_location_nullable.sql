-- occurrence.location_id nullable-ra: helyszín kezdetben lehet ismeretlen
ALTER TABLE occurrence
  ALTER COLUMN location_id DROP NOT NULL;
