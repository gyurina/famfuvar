-- Magyar tárgyeset a fuvar-mondatokhoz: „Judit begyűjti Simit”.
-- Nem algoritmus — a családnál kevés név van, egyszer kell kitölteni.

alter table person
  add column if not exists name_acc text;

update person set name_acc = 'Gyurit'  where display_name = 'Gyuri'  and name_acc is null;
update person set name_acc = 'Juditot' where display_name = 'Judit'  and name_acc is null;
update person set name_acc = 'Papit'   where display_name = 'Papi'   and name_acc is null;
update person set name_acc = 'Mamit'   where display_name = 'Mami'   and name_acc is null;
update person set name_acc = 'Nanit'   where display_name = 'Nani'   and name_acc is null;
update person set name_acc = 'Simit'   where display_name = 'Simi'   and name_acc is null;
update person set name_acc = 'Jankát'  where display_name = 'Janka'  and name_acc is null;

update person set name_acc = display_name where name_acc is null;

alter table person
  alter column name_acc set not null;

comment on column person.name_acc is 'Tárgyesetű név a UI-mondatokhoz (Simit, Jankát).';
