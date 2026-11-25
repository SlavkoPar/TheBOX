# terminal 1
# cd backend; 

# docker run -d --name thebox-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=thebox -p 5432:5432 -v thebox-pgdata:/var/lib/postgresql/data postgres:17
# After a reboot, bring the same database back with:
# docker start thebox-db
# flask db upgrade
# connection: postgresql://postgres:postgres@localhost:5432/thebox

### .venv\Scripts\activate; 
# source .venv/Scripts/activate
# flask run --debug

# in VS Code, the "PostgreSQL" or "SQLTools" extension will show the tables in a side panel. 

# terminal 2
# cd frontend
# npm run dev
