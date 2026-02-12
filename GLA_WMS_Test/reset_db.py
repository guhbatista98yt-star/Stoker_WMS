import sqlite3
import sys

DB_PATH = './database.db'

def reset_database():
    """
    Reseta todas as tabelas de dados operacionais,
    mantendo apenas o usuário 'admin' (username='admin').
    """
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        print(f"[RESET] Conectado a {DB_PATH}")
        print("[RESET] Iniciando limpeza...")
        
        # 1. Limpar tabela de usuários
        print("[RESET] Limpando usuários...")
        
        # A. Remover não-admins
        try:
            cursor.execute("DELETE FROM users WHERE username != 'admin'")
            deleted_others = cursor.rowcount
            print(f"  ✓ Users (Outros): {deleted_others} removidos")
        except sqlite3.Error as e:
            print(f"  ⚠ Erro ao remover outros users: {e}")

        # B. Remover duplicatas de admin (Manter apenas o mais antigo/menor rowid)
        try:
            cursor.execute("""
                DELETE FROM users 
                WHERE username = 'admin' 
                AND rowid NOT IN (
                    SELECT MIN(rowid) FROM users WHERE username = 'admin'
                )
            """)
            deleted_dup = cursor.rowcount
            if deleted_dup > 0:
                print(f"  ✓ Users (Admin Duplicado): {deleted_dup} removidos (1 mantido)")
        except sqlite3.Error as e:
            print(f"  ⚠ Erro ao remover duplicatas de admin: {e}")

        # 2. Tabelas para limpar TOTALMENTE
        tables_to_clear = [
            'sessions',
            'work_units', 
            'cache_orcamentos',
            'cache_vendas_pendentes', 
            'cache_tubos_conexoes',
            'order_items', 
            'orders', 
            'products', 
            'routes', 
            'sections',
            'section_groups',
            'picking_sessions',
            'exceptions', 
            'audit_logs', 
            'companies', 
            'goals', 
            'alerts'
        ]
        
        for table in tables_to_clear:
            try:
                # Verificar se tabela existe antes de deletar
                cursor.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table}'")
                if cursor.fetchone():
                    cursor.execute(f"DELETE FROM {table}")
                    deleted = cursor.rowcount
                    print(f"  ✓ {table}: {deleted} registros removidos")
                    
                    # Resetar AutoIncrement se aplicável (sqlite_sequence)
                    cursor.execute(f"DELETE FROM sqlite_sequence WHERE name='{table}'")
                else:
                    print(f"  - {table}: Tabela não encontrada (ignorado)")
            except sqlite3.Error as e:
                print(f"  ⚠ {table}: {str(e)}")
        
        # Commit changes
        conn.commit()
        
        # Validar Admin
        cursor.execute("SELECT COUNT(*) FROM users")
        user_count = cursor.fetchone()[0]
        
        cursor.execute("SELECT username FROM users")
        remaining_users = [r[0] for r in cursor.fetchall()]

        print(f"\n[RESET] ✓ Reset concluído!")
        print(f"[RESET] Usuários restantes: {user_count} {remaining_users}")
        print(f"[RESET] Execute 'python sync_db2.py' para recarregar dados do ERP.")
        
        conn.close()
        
    except Exception as e:
        print(f"[ERRO] Falha ao resetar banco: {e}")
        sys.exit(1)

if __name__ == "__main__":
    confirm = input("⚠️  ATENÇÃO: Isso vai apagar TODOS os dados (Pedidos, Produtos, Usuários não-admin). Deseja continuar? (s/N): ")
    
    if confirm.lower() in ['s', 'sim', 'yes', 'y']:
        reset_database()
    else:
        print("[RESET] Operação cancelada pelo usuário.")
