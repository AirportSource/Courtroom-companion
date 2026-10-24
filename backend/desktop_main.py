"""PyInstaller entry point for the Windows desktop build (also runnable: python desktop_main.py)."""

import multiprocessing

if __name__ == "__main__":
    multiprocessing.freeze_support()
    from app.desktop.launcher import main

    main()
