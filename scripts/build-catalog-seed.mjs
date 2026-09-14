import { readFile } from "node:fs/promises";

const source = JSON.parse(await readFile(new URL("../data/imoveis.json", import.meta.url), "utf8"));
const items = source.filter(item => item.codigo && item.codigo !== "VCI000001");
const sqlLiteral = value => `'${String(value).replaceAll("'", "''")}'`;
const payload = sqlLiteral(JSON.stringify(items));

process.stdout.write(`begin;
do $$ declare target_org uuid; item jsonb; saved_id uuid; image text; image_index integer;
begin
  select organization_id into target_org from public.organization_sites where hostname='valdineycapistranoimoveis.com.br' and status='active' limit 1;
  if target_org is null then raise exception 'Dominio sem organizacao vinculada'; end if;
  for item in select value from jsonb_array_elements(${payload}::jsonb) loop
    insert into public.properties(organization_id,code,title,slug,purpose,property_type,description,price,city,state,neighborhood,public_address,total_area,total_area_unit,built_area,bedrooms,suites,bathrooms,parking_spaces,features,status,is_published,featured,video_url,publication_date,broker_name,broker_creci,disclosure)
    values(target_org,item->>'codigo',item->>'titulo',item->>'slug',coalesce(item->>'finalidade','venda'),item->>'tipo',item->>'descricao',nullif(item->>'preco','')::numeric,item->>'cidade',item->>'estado',item->>'bairro',item->>'enderecoExibir',nullif(item->>'areaTotal','')::numeric,coalesce(item->>'unidadeAreaTotal','m²'),nullif(item->>'areaConstruida','')::numeric,nullif(item->>'quartos','')::smallint,nullif(item->>'suites','')::smallint,nullif(item->>'banheiros','')::smallint,nullif(item->>'vagas','')::smallint,coalesce(array(select jsonb_array_elements_text(item->'caracteristicas')),'{}'),'available',coalesce((item->>'ativo')::boolean,false),coalesce((item->>'destaque')::boolean,false),nullif(item->>'video',''),nullif(item->>'dataPublicacao','')::date,item#>>'{corretor,nome}',item#>>'{corretor,creci}',jsonb_build_object('static_source',true))
    on conflict(organization_id,code) do update set title=excluded.title,slug=excluded.slug,purpose=excluded.purpose,property_type=excluded.property_type,description=excluded.description,price=excluded.price,city=excluded.city,state=excluded.state,neighborhood=excluded.neighborhood,public_address=excluded.public_address,total_area=excluded.total_area,total_area_unit=excluded.total_area_unit,built_area=excluded.built_area,bedrooms=excluded.bedrooms,suites=excluded.suites,bathrooms=excluded.bathrooms,parking_spaces=excluded.parking_spaces,features=excluded.features,is_published=excluded.is_published,featured=excluded.featured,video_url=excluded.video_url,publication_date=excluded.publication_date,broker_name=excluded.broker_name,broker_creci=excluded.broker_creci,disclosure=excluded.disclosure
    returning id into saved_id;
    delete from public.property_media where property_id=saved_id;
    image_index:=0;
    for image in select value #>> '{}' from jsonb_array_elements(item->'imagens') loop
      insert into public.property_media(organization_id,property_id,storage_path,sort_order,is_cover,alt_text,caption,media_kind)
      values(target_org,saved_id,image,image_index,image_index=0,coalesce(item->'imagensAlt'->>image_index,''),coalesce(item->'legendasImagens'->>image_index,item->>'legendaImagens',''),case when coalesce(item->>'imagensTipo',case when image_index=0 then item->>'capaTipo' end)='projeto' then 'project' else 'photo' end);
      image_index:=image_index+1;
    end loop;
  end loop;
end $$;
commit;
`);
