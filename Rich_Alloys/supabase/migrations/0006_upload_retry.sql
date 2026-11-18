-- Uploads retry on patchy networks. One stored file = one document row, so a retry whose
-- first attempt actually succeeded is recognised (the app treats this violation as "already done")
-- instead of creating a second row for the same file.
create unique index documents_storage_path_key on documents (storage_path);
