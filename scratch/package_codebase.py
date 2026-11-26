import os
import zipfile

source_dir = r"C:\Users\Rajeshwari\.gemini\antigravity\scratch\sreenidhi-transitpulse"
target_zip = r"C:\Users\Rajeshwari\.gemini\antigravity\brain\a1f984c7-5c40-4cc6-9e3e-9a2bbb180640\sreenidhi-express-codebase.zip"

exclude_dirs = {'node_modules', '.git', 'dist', '.vscode', '.idea'}
exclude_files = {'sreenidhi-express-codebase.zip'}

print(f"Creating zip archive: {target_zip}...")
count = 0
with zipfile.ZipFile(target_zip, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(source_dir):
        # Modify dirs in-place to avoid recursing into excluded directories
        dirs[:] = [d for d in dirs if d not in exclude_dirs]
        for file in files:
            if file in exclude_files:
                continue
            full_path = os.path.join(root, file)
            arcname = os.path.relpath(full_path, source_dir)
            z.write(full_path, arcname)
            count += 1

print(f"Zip creation complete! Added {count} files to {target_zip}. File size: {os.path.getsize(target_zip) / (1024*1024):.2f} MB")
