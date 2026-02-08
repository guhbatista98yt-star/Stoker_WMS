import sqlite3
import sys

DB_PATH = './database.db'

def reset_database():
    """
    Reseta todas as tabelas de dados operacionais,
    mantendo apenas a tabela de usuários.
    """
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        print("[RESET] Resetando banco de dados...")
        print("[RESET] Mantendo: Tabela 'users'")
        print("[RESET] Removendo: Pedidos, Rotas, Produtos, Itens, Work Units, Cache...")
        
        # Deletar dados das tabelas operacionais
        tables_to_clear = [
            'orders',
            'order_items',
            'routes',
            'products',
            'work_units',
            'cache_orcamentos',
            'pickup_points',
            'sections'
        ]
        
        for table in tables_to_clear:
            try:
                cursor.execute(f"DELETE FROM {table}")
                deleted = cursor.rowcount
                print(f"  ✓ {table}: {deleted} registros removidos")
            except sqlite3.Error as e:
                print(f"  ⚠ {table}: {str(e)}")
        
        # Commit changes
        conn.commit()
        
        # Mostrar contagem de usuários mantidos
        cursor.execute("SELECT COUNT(*) FROM users")
        user_count = cursor.fetchone()[0]
        
        print(f"\n[RESET] ✓ Reset concluído!")
        print(f"[RESET] Usuários mantidos: {user_count}")
        print(f"[RESET] Execute 'python sync_db2.py' para recarregar dados do ERP.")
        
        conn.close()
        
    except Exception as e:
        print(f"[ERRO] Falha ao resetar banco: {e}")
        sys.exit(1)

if __name__ == "__main__":
    confirm = input("⚠️  ATENÇÃO: Isso vai apagar TODOS os pedidos, rotas e produtos. Deseja continuar? (s/N): ")
    
    if confirm.lower() in ['s', 'sim', 'yes', 'y']:
        reset_database()
    else:
        print("[RESET] Operação cancelada pelo usuário.")
